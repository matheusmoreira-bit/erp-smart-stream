// Escalonamento automático por SLA.
// Documentos parados em `pendente_aprovacao` além do prazo (horas úteis)
// sobem automaticamente para o substituto vigente ou para o próximo nível
// da matriz de alçadas, com registro em auditoria e notificação.
//
// Executado por pg_cron (a cada 15 min) e também sob demanda (dry_run).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { notifyApprovalPending } from "../_shared/approval-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Settings {
  company_db: string | null;
  enabled: boolean;
  sla_business_hours: number;
  repeat_business_hours: number;
  prefer_substitute: boolean;
  escalate_to_next_level: boolean;
  fallback_email: string | null;
  max_escalations: number;
  notify_in_app: boolean;
  notify_email: boolean;
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().trim();
const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const emailPrefix = (s: string) => {
  const v = norm(s);
  const i = v.indexOf("@");
  return i > 0 ? v.slice(0, i) : v;
};
const tokens = (s: string) =>
  stripAccents(norm(s)).replace(/[._\-@]+/g, " ").split(/\s+/).filter(Boolean);

/** Compara duas identidades (nome ou e-mail) de forma tolerante. */
function sameIdentity(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (emailPrefix(x) && emailPrefix(x) === emailPrefix(y)) return true;
  const tx = tokens(x), ty = tokens(y);
  if (tx.length === 0 || ty.length === 0) return false;
  const short = tx.length <= ty.length ? tx : ty;
  const long = short === tx ? ty : tx;
  if (short.length < 2) return false;
  return short.every((t) => long.includes(t));
}

/** Soma horas úteis (seg–sex, dia inteiro) a partir de uma data. */
function addBusinessHours(start: Date, hours: number): Date {
  let remaining = Math.max(1, Math.round(hours));
  const cur = new Date(start.getTime());
  while (remaining > 0) {
    cur.setUTCHours(cur.getUTCHours() + 1);
    const dow = cur.getUTCDay(); // 0 dom, 6 sáb
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return cur;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: { dry_run?: boolean; company_db?: string | null; expense_id?: string | null } = {};
  try {
    payload = await req.json();
  } catch {
    /* cron envia corpo simples */
  }
  const dryRun = payload.dry_run === true;
  const now = new Date();
  const t0 = Date.now();

  try {
    // 1. Configurações (global = company_db NULL)
    const { data: settingsRows, error: settingsErr } = await admin
      .from("sla_escalation_settings")
      .select("*");
    if (settingsErr) return json(500, { error: settingsErr.message });

    const all = (settingsRows || []) as Settings[];
    const global = all.find((s) => !s.company_db) || null;
    const byCompany = new Map<string, Settings>();
    for (const s of all) if (s.company_db) byCompany.set(s.company_db, s);

    const settingsFor = (db: string): Settings | null => byCompany.get(db) || global;

    // 2. Documentos pendentes
    let q = admin
      .from("expenses")
      .select(
        "id, company_db, doc_type, supplier_name, requester_name, requester_email, current_approver, original_approver, current_level_order, approval_rule_id, total_amount, currency, sap_doc_num, updated_at, created_at",
      )
      .eq("status", "pendente_aprovacao")
      .limit(500);
    if (payload.company_db) q = q.eq("company_db", payload.company_db);
    if (payload.expense_id) q = q.eq("id", payload.expense_id);

    const { data: pending, error: pendErr } = await q;
    if (pendErr) return json(500, { error: pendErr.message });

    const docs = (pending || []) as any[];
    if (docs.length === 0) {
      return json(200, { ok: true, scanned: 0, escalated: 0, results: [], dry_run: dryRun });
    }

    // 3. Escalonamentos anteriores
    const ids = docs.map((d) => d.id);
    const { data: prevRows } = await admin
      .from("sla_escalations")
      .select("expense_id, created_at, escalation_index")
      .in("expense_id", ids)
      .order("created_at", { ascending: false });
    const prevByDoc = new Map<string, { created_at: string; escalation_index: number }[]>();
    for (const r of (prevRows || []) as any[]) {
      const arr = prevByDoc.get(r.expense_id) || [];
      arr.push(r);
      prevByDoc.set(r.expense_id, arr);
    }

    // 4. Substituições vigentes
    const { data: subsRows } = await admin
      .from("approver_substitutes")
      .select("id, company_db, official_email, official_name, substitute_email, substitute_name, starts_at, ends_at, revoked_at")
      .is("revoked_at", null)
      .lte("starts_at", now.toISOString())
      .gte("ends_at", now.toISOString());
    const subs = (subsRows || []) as any[];

    const results: any[] = [];
    let escalated = 0;

    for (const doc of docs) {
      const cfg = settingsFor(doc.company_db);
      if (!cfg || !cfg.enabled) continue;

      const history = prevByDoc.get(doc.id) || [];
      const escCount = history.length;
      if (escCount >= Math.max(1, cfg.max_escalations)) continue;

      const pendingSince = new Date(
        history[0]?.created_at || doc.updated_at || doc.created_at,
      );
      const hours = escCount === 0 ? cfg.sla_business_hours : cfg.repeat_business_hours;
      const deadline = addBusinessHours(pendingSince, hours);
      if (now < deadline) continue;

      const currentApprover: string | null = doc.current_approver;
      let target: { name: string | null; email: string | null; kind: string; levelTo: number | null; substitutionId: string | null } | null = null;

      // 4.1 Substituto vigente
      if (cfg.prefer_substitute && currentApprover) {
        const match = subs.find(
          (s) =>
            (!s.company_db || s.company_db === doc.company_db) &&
            (sameIdentity(currentApprover, s.official_email) ||
              sameIdentity(currentApprover, s.official_name)),
        );
        if (match) {
          target = {
            name: match.substitute_name || null,
            email: match.substitute_email || null,
            kind: "substitute",
            levelTo: doc.current_level_order,
            substitutionId: match.id,
          };
        }
      }

      // 4.2 Próximo nível da matriz (superior)
      if (!target && cfg.escalate_to_next_level && doc.approval_rule_id) {
        const { data: lvls } = await admin
          .from("approval_rule_levels")
          .select("level_order, approver_name, approver_email")
          .eq("rule_id", doc.approval_rule_id)
          .order("level_order", { ascending: true });
        const next = ((lvls || []) as any[]).find(
          (l) => Number(l.level_order) > Number(doc.current_level_order || 1),
        );
        if (next) {
          target = {
            name: next.approver_name || null,
            email: next.approver_email || null,
            kind: "next_level",
            levelTo: Number(next.level_order),
            substitutionId: null,
          };
        }
      }

      // 4.3 Fallback configurado
      if (!target && cfg.fallback_email) {
        target = {
          name: null,
          email: cfg.fallback_email,
          kind: "fallback",
          levelTo: doc.current_level_order,
          substitutionId: null,
        };
      }

      if (!target) {
        results.push({ expense_id: doc.id, skipped: "sem_destino" });
        continue;
      }

      const newApprover = target.name || target.email;
      if (!newApprover || sameIdentity(newApprover, currentApprover)) {
        results.push({ expense_id: doc.id, skipped: "destino_igual" });
        continue;
      }

      const entry = {
        expense_id: doc.id,
        company_db: doc.company_db,
        doc_num: doc.sap_doc_num ? String(doc.sap_doc_num) : null,
        doc_type: doc.doc_type,
        supplier_name: doc.supplier_name,
        total_amount: doc.total_amount,
        currency: doc.currency,
        from_approver: currentApprover,
        to_approver: newApprover,
        target_kind: target.kind,
        level_from: doc.current_level_order,
        level_to: target.levelTo,
        substitution_id: target.substitutionId,
        pending_since: pendingSince.toISOString(),
        sla_deadline: deadline.toISOString(),
        escalation_index: escCount + 1,
        notes: `SLA de ${hours}h úteis excedido`,
      };

      if (dryRun) {
        results.push({ ...entry, dry_run: true });
        escalated += 1;
        continue;
      }

      const { error: updErr } = await admin
        .from("expenses")
        .update({
          current_approver: newApprover,
          original_approver: doc.original_approver || currentApprover,
          current_level_order: target.levelTo ?? doc.current_level_order,
          updated_at: new Date().toISOString(),
        })
        .eq("id", doc.id)
        .eq("status", "pendente_aprovacao");
      if (updErr) {
        results.push({ expense_id: doc.id, error: updErr.message });
        continue;
      }

      await admin.from("sla_escalations").insert(entry);

      await admin.from("audit_log").insert({
        actor_email: "system:sla-escalation",
        action: "sla_auto_escalation",
        entity_type: "expense",
        entity_id: doc.id,
        company_db: doc.company_db,
        details: entry,
      });

      if (cfg.notify_in_app || cfg.notify_email) {
        await notifyApprovalPending(admin, {
          expenseId: doc.id,
          companyDb: doc.company_db,
          approverEmail: cfg.notify_email ? target.email : null,
          approverName: target.name,
          levelOrder: target.levelTo,
          requesterName: doc.requester_name,
          supplierName: doc.supplier_name,
          totalAmount: doc.total_amount,
          currency: doc.currency,
          docType: doc.doc_type,
          resolution: {
            source: target.kind === "substitute" ? "substitute" : "sla_escalation",
            reason: `SLA de ${hours}h úteis excedido — documento escalado de ${currentApprover || "—"} para ${target.name}`,
            ruleId: (doc as any).approval_rule_id || null,
            costCenter: (doc as any).cost_center || null,
            project: (doc as any).project || null,
            metadata: {
              target_kind: target.kind,
              level_from: doc.current_level_order,
              level_to: target.levelTo,
              substitution_id: target.substitutionId,
              escalation_index: escCount + 1,
            },
          },
        });

      }

      escalated += 1;
      results.push(entry);
    }

    return json(200, {
      ok: true,
      scanned: docs.length,
      escalated,
      dry_run: dryRun,
      duration_ms: Date.now() - t0,
      results,
    });
  } catch (e) {
    console.error("[sla-escalation-dispatch]", e);
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
