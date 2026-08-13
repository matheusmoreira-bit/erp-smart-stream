// Delegação temporária de alçada (férias/ausências).
//
// Gerencia `public.approver_substitutes` no servidor porque a maior parte dos
// usuários autentica via SAP (sem auth.uid()), e o RLS da tabela só permite
// escrita para admins do Lovable Cloud. Aqui autorizamos:
//   - Cloud admin ou SAP admin/superuser  -> gerencia qualquer substituição
//   - Qualquer usuário autenticado        -> gerencia apenas as SUAS próprias
//                                            ausências (official = ele mesmo)
//
// Toda concessão/revogação grava `audit_log` e notifica o substituto.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireUser, validateSapSession, AuthError } from "../_shared/auth.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

interface SubstituteRow {
  id: string;
  company_db: string | null;
  official_email: string;
  official_name: string | null;
  substitute_email: string;
  substitute_name: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  granted_by_id: string | null;
  granted_by_email: string;
  revoked_at: string | null;
  revoked_by_id: string | null;
  revoked_by_email: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

function normalize(v: unknown): string {
  return String(v ?? "").toLowerCase().trim();
}
function localPart(v: string): string {
  const n = normalize(v);
  const i = n.indexOf("@");
  return i > 0 ? n.slice(0, i) : n;
}
function matchesIdentity(value: string | null | undefined, identities: Set<string>): boolean {
  const v = normalize(value);
  if (!v) return false;
  return identities.has(v) || identities.has(localPart(v));
}

Deno.serve(async (req) => {
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  const corsHeaders = corsFor(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: {
    action?: "list" | "create" | "revoke";
    id?: string;
    official_email?: string;
    official_name?: string | null;
    substitute_email?: string;
    substitute_name?: string | null;
    starts_at?: string;
    ends_at?: string;
    reason?: string | null;
    company_db?: string | null;
    /** Prefixos de centro de custo que limitam a substituição (ex.: ["1.8"]). */
    cost_center_prefixes?: string[] | null;
  } = {};

  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Corpo inválido (JSON malformado)." });
  }

  const action = body.action || "list";
  if (!["list", "create", "revoke"].includes(action)) {
    return json(400, { error: "action deve ser 'list', 'create' ou 'revoke'." });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ── Identidade do chamador ────────────────────────────────────────────
  const identities = new Set<string>();
  let callerEmail: string | null = null;
  let callerName: string | null = null;
  let isAdminCaller = false;

  try {
    const cloudUser = await requireUser(req);
    callerEmail = cloudUser.email || null;
    if (callerEmail) {
      identities.add(normalize(callerEmail));
      identities.add(localPart(callerEmail));
    }
    const { data: hasAdmin } = await admin.rpc("has_role", {
      _user_id: cloudUser.id,
      _role: "admin",
    });
    if (hasAdmin === true) isAdminCaller = true;
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }

  const sap = await validateSapSession(req);
  if (sap) {
    callerName = sap.userName || callerName;
    if (!callerEmail) callerEmail = sap.email || null;
    for (const v of [sap.userName, sap.email]) {
      if (v) {
        identities.add(normalize(v));
        identities.add(localPart(v));
      }
    }
    try {
      const { data: mappedAdmin } = await admin.rpc("is_sap_user_admin", {
        _sap_username: normalize(sap.userName),
      });
      if (mappedAdmin === true) isAdminCaller = true;
    } catch { /* noop */ }
    if (normalize(sap.userName) === "manager") isAdminCaller = true;
  }

  if (identities.size === 0 && !isAdminCaller) {
    return json(401, {
      error: "Não autenticado — faça login no ERP ou no Backoffice para gerenciar substituições.",
    });
  }

  const actorLabel = callerEmail || callerName || "desconhecido";

  // ── LIST ──────────────────────────────────────────────────────────────
  if (action === "list") {
    const { data, error } = await admin
      .from("approver_substitutes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return json(500, { error: `Falha ao listar substituições: ${error.message}` });
    const rows = (data || []) as SubstituteRow[];
    const visible = isAdminCaller
      ? rows
      : rows.filter(
          (r) =>
            matchesIdentity(r.official_email, identities) ||
            matchesIdentity(r.substitute_email, identities) ||
            matchesIdentity(r.granted_by_email, identities),
        );
    return json(200, { rows: visible, is_admin: isAdminCaller, caller: actorLabel });
  }

  // ── CREATE ────────────────────────────────────────────────────────────
  if (action === "create") {
    const officialEmail = String(body.official_email || "").trim();
    const substituteEmail = String(body.substitute_email || "").trim();
    const startsAt = String(body.starts_at || "").trim();
    const endsAt = String(body.ends_at || "").trim();

    if (!officialEmail || !substituteEmail) {
      return json(400, { error: "official_email e substitute_email são obrigatórios." });
    }
    if (normalize(officialEmail) === normalize(substituteEmail)) {
      return json(400, { error: "Aprovador oficial e substituto devem ser diferentes." });
    }
    const s = Date.parse(startsAt);
    const e = Date.parse(endsAt);
    if (!Number.isFinite(s) || !Number.isFinite(e)) {
      return json(400, { error: "Período inválido (starts_at/ends_at)." });
    }
    if (e <= s) return json(400, { error: "O fim da vigência deve ser posterior ao início." });
    if (e - s > 1000 * 60 * 60 * 24 * 365) {
      return json(400, { error: "A vigência máxima de uma substituição é de 365 dias." });
    }

    if (!isAdminCaller && !matchesIdentity(officialEmail, identities)) {
      return json(403, {
        error: "Você só pode definir substituto para a sua própria alçada.",
      });
    }

    // Escopo opcional por centro de custo (prefixos). Normaliza e valida
    // formato simples de CC (dígitos e pontos), evitando entrada arbitrária.
    const ccPrefixes = Array.isArray(body.cost_center_prefixes)
      ? Array.from(
          new Set(
            body.cost_center_prefixes
              .map((p) => String(p || "").trim().replace(/%+$/, "").replace(/\.+$/, ""))
              .filter((p) => /^[0-9]+(\.[0-9]+)*$/.test(p)),
          ),
        )
      : [];

    const insertRow = {
      official_email: officialEmail,
      official_name: body.official_name || null,
      substitute_email: substituteEmail,
      substitute_name: body.substitute_name || null,
      starts_at: new Date(s).toISOString(),
      ends_at: new Date(e).toISOString(),
      reason: body.reason || null,
      company_db: body.company_db || null,
      cost_center_prefixes: ccPrefixes.length ? ccPrefixes : null,
      granted_by_id: null as string | null,
      granted_by_email: actorLabel,
    };



    const { data: created, error: insErr } = await admin
      .from("approver_substitutes")
      .insert(insertRow)
      .select("*")
      .maybeSingle();
    if (insErr) return json(500, { error: `Falha ao criar substituição: ${insErr.message}` });

    await admin.from("audit_log").insert({
      actor_email: actorLabel,
      action: "grant_approver_substitute",
      entity_type: "approver_substitute",
      entity_id: (created as SubstituteRow | null)?.id ?? null,
      company_db: insertRow.company_db,
      details: {
        officialEmail,
        officialName: insertRow.official_name,
        substituteEmail,
        substituteName: insertRow.substitute_name,
        startsAt: insertRow.starts_at,
        endsAt: insertRow.ends_at,
        reason: insertRow.reason,
        selfService: !isAdminCaller,
        grantedBy: actorLabel,
      },
    });

    const period = `${new Date(s).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} a ${new Date(e).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
    const officialLabel = insertRow.official_name || officialEmail;
    await admin.from("notifications").insert([
      {
        user_identifier: normalize(substituteEmail),
        title: "Você foi definido como aprovador substituto",
        body: `Você aprova em nome de ${officialLabel} de ${period}.`,
        category: "approval",
        company_db: insertRow.company_db,
        link: "/aprovacoes",
        metadata: { substitution_id: (created as SubstituteRow | null)?.id ?? null },
      },
      {
        user_identifier: normalize(officialEmail),
        title: "Substituto de alçada definido",
        body: `${insertRow.substitute_name || substituteEmail} aprovará em seu nome de ${period}.`,
        category: "approval",
        company_db: insertRow.company_db,
        link: "/aprovacoes",
        metadata: { substitution_id: (created as SubstituteRow | null)?.id ?? null },
      },
    ]);

    // ── Aplicação imediata aos fluxos JÁ pendentes ──────────────────────
    // A visibilidade/autorização do substituto é resolvida em tempo de
    // execução (expense-read, approvals-feed e expense-approval-action já
    // consultam a janela vigente), portanto os documentos pendentes passam a
    // aparecer para o substituto sem qualquer reprocessamento. O que faltava
    // era o aviso: aqui notificamos o substituto, na hora, de cada documento
    // que já está parado na alçada do titular dentro da vigência.
    let backfilled = 0;
    const nowMs = Date.now();
    if (s <= nowMs && e >= nowMs) {
      try {
        const officialKeys = new Set(
          [normalize(officialEmail), localPart(officialEmail), normalize(insertRow.official_name || "")]
            .filter(Boolean),
        );
        let q = admin
          .from("expenses")
          .select("id, company_db, supplier_name, total_amount, currency, current_approver, cost_center")
          .eq("status", "pendente_aprovacao")
          .limit(500);
        if (insertRow.company_db) q = q.eq("company_db", insertRow.company_db);
        const { data: pending } = await q;

        const matches = ((pending || []) as Array<Record<string, any>>).filter((d) => {
          const appr = normalize(d.current_approver);
          if (!appr) return false;
          const tokens = new Set<string>([appr, localPart(appr), ...appr.split(/[,;/]+/).map((t) => normalize(t))]);
          const hit = Array.from(officialKeys).some((k) => tokens.has(k) || appr.includes(k));
          if (!hit) return false;
          if (ccPrefixes.length) {
            const cc = String(d.cost_center || "");
            return ccPrefixes.some((p) => cc === p || cc.startsWith(`${p}.`));
          }
          return true;
        });

        if (matches.length > 0) {
          const rows = matches.slice(0, 100).map((d) => ({
            user_identifier: normalize(substituteEmail),
            title: "Documento pendente transferido para sua alçada (substituição)",
            body: `Você aprova em nome de ${officialLabel} · Fornecedor: ${d.supplier_name || "—"} · Valor: ${d.currency || "BRL"} ${Number(d.total_amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
            category: "approval",
            company_db: d.company_db ?? insertRow.company_db,
            link: `/aprovacoes?doc=internal%3A${encodeURIComponent(String(d.id))}`,
            metadata: {
              substitution_id: (created as SubstituteRow | null)?.id ?? null,
              expense_id: d.id,
              substituted_for_email: normalize(officialEmail),
            },
          }));
          const { error: nErr } = await admin.from("notifications").insert(rows);
          if (!nErr) backfilled = rows.length;
        }
      } catch { /* não bloqueia a criação da substituição */ }
    }

    return json(200, { ok: true, row: created, pending_applied: backfilled });
  }

  // ── REVOKE ────────────────────────────────────────────────────────────
  const id = String(body.id || "").trim();
  if (!id) return json(400, { error: "id é obrigatório para revogar." });

  const { data: row, error: rowErr } = await admin
    .from("approver_substitutes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (rowErr) return json(500, { error: `Falha ao carregar substituição: ${rowErr.message}` });
  if (!row) return json(404, { error: "Substituição não encontrada." });
  const current = row as SubstituteRow;
  if (current.revoked_at) return json(409, { error: "Substituição já revogada." });

  const canRevoke =
    isAdminCaller ||
    matchesIdentity(current.official_email, identities) ||
    matchesIdentity(current.granted_by_email, identities);
  if (!canRevoke) {
    return json(403, {
      error: "Somente o aprovador oficial, quem concedeu ou um administrador pode revogar.",
    });
  }

  const revokedAt = new Date().toISOString();
  const { error: updErr } = await admin
    .from("approver_substitutes")
    .update({
      revoked_at: revokedAt,
      revoked_by_id: null,
      revoked_by_email: actorLabel,
      revoked_reason: body.reason || null,
    })
    .eq("id", id)
    .is("revoked_at", null);
  if (updErr) return json(500, { error: `Falha ao revogar: ${updErr.message}` });

  await admin.from("audit_log").insert({
    actor_email: actorLabel,
    action: "revoke_approver_substitute",
    entity_type: "approver_substitute",
    entity_id: id,
    company_db: current.company_db,
    details: {
      officialEmail: current.official_email,
      substituteEmail: current.substitute_email,
      startsAt: current.starts_at,
      endsAt: current.ends_at,
      revokedAt,
      reason: body.reason || null,
      selfService: !isAdminCaller,
      revokedBy: actorLabel,
    },
  });

  await admin.from("notifications").insert({
    user_identifier: normalize(current.substitute_email),
    title: "Substituição de alçada encerrada",
    body: `Sua delegação para aprovar em nome de ${current.official_name || current.official_email} foi revogada.`,
    category: "approval",
    company_db: current.company_db,
    link: "/aprovacoes",
    metadata: { substitution_id: id },
  });

  return json(200, { ok: true, id, revoked_at: revokedAt });
});
