// Edge function: authorize + execute internal expense approval / rejection.
//
// The client (React app) previously wrote directly to `public.expenses` via
// the Supabase anon key. Because the app authenticates users through SAP and
// not through Lovable Cloud auth, RLS on `expenses` cannot key off auth.uid()
// and had to allow anon UPDATE — meaning any signed-in SAP user could POST an
// approval for a document assigned to someone else.
//
// This function moves the authorization decision to the server:
//   - Validates the caller has a real SAP session (via x-sap-* headers), or
//     is a Lovable Cloud admin (via Bearer JWT + user_roles.admin).
//   - Loads the expense + its approval rule levels and computes the CURRENT
//     level's designated approver.
//   - Rejects the call unless the caller matches that approver by email /
//     email-prefix / exact name tokens, OR is a Cloud admin / SAP superuser /
//     mapped SAP admin (via public.is_sap_user_admin RPC).
//
// Notifications and SAP integration remain on the client side so we don't
// duplicate that logic; the response tells the client what happened so it can
// notify the next approver / requester and trigger `expense-to-sap`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateSapSession, requireUser, AuthError } from "../_shared/auth.ts";
import { pickApproverSkippingRequester, SELF_APPROVAL_FALLBACK } from "../_shared/approval-skip.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Stages ajudam a rastrear em qual passo a requisição foi rejeitada ou falhou.
// O nome do stage vai tanto nos logs (JSON estruturado) quanto no corpo da
// resposta de erro, permitindo que o front-end mostre mensagens específicas.
type Stage =
  | "cors"
  | "parse_body"
  | "idempotency_reserve"
  | "idempotency_replay"
  | "idempotency_conflict"
  | "auth_cloud"
  | "auth_sap"
  | "auth_none"
  | "load_expense"
  | "load_levels"
  | "authorize"
  | "self_approval_guard"
  | "update_reject"
  | "update_advance_level"
  | "update_final_approve"
  | "success";

function stageLog(stage: Stage, level: "info" | "warn" | "error", data: Record<string, unknown>) {
  const line = JSON.stringify({ fn: "expense-approval-action", stage, level, ts: new Date().toISOString(), ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}


function normalize(s: unknown): string {
  return String(s ?? "").toLowerCase().trim();
}
function emailPrefix(email: string): string {
  const e = normalize(email);
  const i = e.indexOf("@");
  return i > 0 ? e.slice(0, i) : e;
}
function tokenize(s: string): string[] {
  return normalize(s).replace(/[._\-@]+/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Strict identity match — no fuzzy edit distance. We accept:
 *   - caller == approver email                              (exact)
 *   - prefix-before-@ of caller == prefix-before-@ of email (SAP UserCode)
 *   - normalized token set of caller ⊆ token set of approver name
 *     AND at least one token in common — protects against unrelated names
 *     coincidentally sharing a very common single token.
 */
function isDesignatedApprover(
  caller: string,
  approverName: string | null,
  approverEmail: string | null,
): boolean {
  const c = normalize(caller);
  if (!c) return false;

  const ae = normalize(approverEmail);
  if (ae) {
    if (c === ae) return true;
    if (emailPrefix(c) === emailPrefix(ae) && emailPrefix(ae).length > 0) return true;
  }

  const nameTokens = tokenize(approverName || "");
  const callerTokens = tokenize(caller);
  if (nameTokens.length === 0 || callerTokens.length === 0) return false;

  // Every caller token must appear EXACTLY in the approver's name tokens.
  const allIn = callerTokens.every((t) => nameTokens.includes(t));
  // And we require at least two matching tokens OR full coverage of the
  // approver name — a single common first name is not enough.
  if (!allIn) return false;
  if (callerTokens.length >= 2) return true;
  return nameTokens.length === 1; // approver name itself is a single token
}

async function isSapSuperuser(
  admin: ReturnType<typeof createClient>,
  companyDB: string,
  sapSession: string,
  routeId: string,
  sapUser: string,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from("system_credentials")
      .select("credential_value")
      .eq("company_db", companyDB)
      .eq("system_name", "sap")
      .eq("credential_key", "service_layer_url")
      .maybeSingle();
    const fallback = Deno.env.get("SAP_DEFAULT_BASE_URL") ||
      "https://jyl32uqm9176-sl.s1p-zona-01-4fd9831d6a58.saas.wevy.cloud/b1s/v2";
    const raw = typeof (data as any)?.credential_value === "string" && (data as any).credential_value.trim()
      ? (data as any).credential_value.trim()
      : fallback;
    let baseUrl = raw.replace(/\/+$/, "");
    if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
    else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;

    const escaped = sapUser.replace(/'/g, "''");
    const url = `${baseUrl}/Users?$filter=${encodeURIComponent(`UserCode eq '${escaped}'`)}&$select=UserCode,Superuser`;
    const resp = await fetch(url, {
      headers: { Cookie: `B1SESSION=${sapSession}${routeId ? `; ROUTEID=${routeId}` : ""}` },
    });
    if (!resp.ok) return false;
    const payload = await resp.json().catch(() => null) as { value?: { Superuser?: string }[] } | null;
    return payload?.value?.some((r) => r.Superuser === "tYES") === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const requestId =
    req.headers.get("x-request-id") ||
    req.headers.get("cf-ray") ||
    crypto.randomUUID();

  if (req.method === "OPTIONS") {
    stageLog("cors", "info", { requestId, method: "OPTIONS" });
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    stageLog("cors", "warn", { requestId, method: req.method, reason: "method_not_allowed" });
    return json(405, { error: "Method not allowed", stage: "cors", requestId });
  }

  let body: { expense_id?: string; action?: string; remarks?: string } = {};
  try {
    body = await req.json();
  } catch (e) {
    stageLog("parse_body", "error", { requestId, error: (e as Error).message });
    return json(400, { error: "Corpo inválido (JSON malformado).", stage: "parse_body", requestId });
  }

  const expenseId = String(body.expense_id || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const remarks = body.remarks?.toString().trim() || null;
  if (!expenseId) {
    stageLog("parse_body", "warn", { requestId, reason: "missing_expense_id" });
    return json(400, { error: "expense_id é obrigatório.", stage: "parse_body", requestId });
  }
  if (action !== "approve" && action !== "reject") {
    stageLog("parse_body", "warn", { requestId, reason: "invalid_action", received: action });
    return json(400, { error: "action deve ser 'approve' ou 'reject'.", stage: "parse_body", requestId });
  }

  stageLog("parse_body", "info", { requestId, expenseId, action, hasRemarks: !!remarks });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Idempotência ───────────────────────────────────────────────────────
  // Aceita `Idempotency-Key` ou `x-idempotency-key`. Se a mesma chave já
  // teve resposta gravada, replicamos a resposta original. Se está em
  // processamento (linha reservada, ainda sem resposta), devolvemos 409
  // — protege contra reenvios por perda de conexão / duplo clique.
  const idempotencyKey =
    (req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key") || "").trim();

  const respond = async (status: number, body: unknown): Promise<Response> => {
    const payload = (typeof body === "object" && body)
      ? { ...(body as Record<string, unknown>), requestId }
      : body;
    if (idempotencyKey) {
      try {
        await admin
          .from("expense_action_idempotency")
          .update({
            status_code: status,
            response: payload as Record<string, unknown>,
            completed_at: new Date().toISOString(),
          })
          .eq("idempotency_key", idempotencyKey);
      } catch (e) {
        stageLog("idempotency_reserve", "warn", {
          requestId, phase: "persist_response", error: (e as Error).message,
        });
      }
    }
    stageLog("success", status >= 400 ? "warn" : "info", {
      requestId, status, elapsedMs: Date.now() - t0,
    });
    return json(status, payload);
  };

  if (idempotencyKey) {
    // 1) Já existe? → devolve a resposta gravada (ou 409 se ainda em curso).
    const { data: prior, error: priorErr } = await admin
      .from("expense_action_idempotency")
      .select("idempotency_key, expense_id, action, status_code, response, completed_at")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (priorErr) {
      stageLog("idempotency_reserve", "error", {
        requestId, phase: "lookup", error: priorErr.message,
      });
      return json(500, {
        error: `Falha ao consultar idempotência: ${priorErr.message}`,
        stage: "idempotency_reserve",
        requestId,
      });
    }
    if (prior) {
      if ((prior as any).expense_id !== expenseId || (prior as any).action !== action) {
        stageLog("idempotency_conflict", "warn", {
          requestId, idempotencyKey,
          existing: { expenseId: (prior as any).expense_id, action: (prior as any).action },
          received: { expenseId, action },
        });
        return json(422, {
          error: "Idempotency-Key já utilizada para outra requisição (expense/action divergentes).",
          stage: "idempotency_conflict",
          requestId,
        });
      }
      if ((prior as any).completed_at && (prior as any).status_code) {
        stageLog("idempotency_replay", "info", {
          requestId, idempotencyKey, replayedStatus: (prior as any).status_code,
        });
        const cached = (prior as any).response ?? { ok: true };
        return json((prior as any).status_code, { ...cached, replayed: true, requestId });
      }
      stageLog("idempotency_conflict", "warn", {
        requestId, idempotencyKey, reason: "in_flight",
      });
      return json(409, {
        error: "Já existe uma requisição idêntica em processamento. Aguarde alguns segundos e tente novamente.",
        stage: "idempotency_conflict",
        requestId,
      });
    }
    // 2) Reserva a chave — falha por conflito indica corrida com outro request.
    const { error: reserveErr } = await admin
      .from("expense_action_idempotency")
      .insert({
        idempotency_key: idempotencyKey,
        expense_id: expenseId,
        action,
      });
    if (reserveErr) {
      stageLog("idempotency_reserve", "error", {
        requestId, idempotencyKey, error: reserveErr.message, code: (reserveErr as any).code,
      });
      // Código 23505 = unique_violation → outra requisição chegou antes.
      const isRace = (reserveErr as any).code === "23505";
      return json(isRace ? 409 : 500, {
        error: isRace
          ? "Requisição idêntica em processamento (conflito ao reservar a chave de idempotência)."
          : `Falha ao reservar chave de idempotência: ${reserveErr.message}`,
        stage: "idempotency_reserve",
        requestId,
      });
    }
    stageLog("idempotency_reserve", "info", { requestId, idempotencyKey });
  }




  // ── Identify caller ────────────────────────────────────────────────────
  const sapSessionHeader = req.headers.get("x-sap-session")?.trim() || "";
  const sapRouteHeader = req.headers.get("x-sap-route")?.trim() || "";
  const sapUserHeader = req.headers.get("x-sap-user")?.trim() || "";
  const sapCompanyHeader = req.headers.get("x-company-db")?.trim() || "";

  let callerIdentity: string | null = null; // used for name/email match
  let callerEmail: string | null = null;
  let isCloudAdmin = false;
  let isSuperUser = false;

  // Try Cloud JWT first (admins may act on any document).
  try {
    const cloudUser = await requireUser(req);
    callerEmail = cloudUser.email || null;
    callerIdentity = cloudUser.email || null;
    const { data: hasAdmin } = await admin.rpc("has_role", {
      _user_id: cloudUser.id, _role: "admin",
    });
    if (hasAdmin === true) isCloudAdmin = true;
    stageLog("auth_cloud", "info", { requestId, callerEmail, isCloudAdmin });
  } catch (e) {
    if (!(e instanceof AuthError)) {
      stageLog("auth_cloud", "error", { requestId, error: (e as Error).message });
      throw e;
    }
    // No Cloud JWT — fall back to SAP session.
    stageLog("auth_cloud", "info", { requestId, note: "no_cloud_jwt_fallback_sap" });
  }

  let sapValidated: Awaited<ReturnType<typeof validateSapSession>> = null;
  if (sapSessionHeader && sapUserHeader && sapCompanyHeader) {
    sapValidated = await validateSapSession(req);
    if (!sapValidated) {
      stageLog("auth_sap", "warn", { requestId, reason: "invalid_or_expired_session", sapUser: sapUserHeader });
      return await respond(401, {
        error: "Sessão SAP inválida ou expirada. Faça login novamente.",
        stage: "auth_sap",
      });
    }
    if (!callerIdentity) callerIdentity = sapValidated.userName;
    try {
      const { data: mappedAdmin } = await admin.rpc("is_sap_user_admin", {
        _sap_username: sapValidated.userName.toLowerCase(),
      });
      if (mappedAdmin === true) isSuperUser = true;
    } catch (e) {
      stageLog("auth_sap", "warn", { requestId, phase: "is_sap_user_admin", error: (e as Error).message });
    }
    if (!isSuperUser && sapValidated.userName.toLowerCase() === "manager") isSuperUser = true;
    if (!isSuperUser) {
      isSuperUser = await isSapSuperuser(
        admin, sapValidated.companyDB, sapSessionHeader, sapRouteHeader, sapValidated.userName,
      );
    }
    stageLog("auth_sap", "info", {
      requestId, sapUser: sapValidated.userName, companyDB: sapValidated.companyDB, isSuperUser,
    });
  }

  if (!callerIdentity && !isCloudAdmin) {
    stageLog("auth_none", "warn", { requestId });
    return await respond(401, {
      error: "Não autenticado — envie um JWT válido do Lovable Cloud ou os headers x-sap-* de uma sessão SAP ativa.",
      stage: "auth_none",
    });
  }

  // ── Load expense ───────────────────────────────────────────────────────
  const { data: exp, error: expErr } = await admin
    .from("expenses")
    .select("id, approval_rule_id, current_level_order, status, current_approver, requester_name, requester_email, supplier_name, total_amount, currency, company_db")
    .eq("id", expenseId)
    .maybeSingle();
  if (expErr) {
    stageLog("load_expense", "error", { requestId, expenseId, error: expErr.message });
    return await respond(500, { error: `Falha ao carregar despesa: ${expErr.message}`, stage: "load_expense" });
  }
  if (!exp) {
    stageLog("load_expense", "warn", { requestId, expenseId, reason: "not_found" });
    return await respond(404, { error: "Despesa não encontrada.", stage: "load_expense" });
  }
  if ((exp as any).status !== "pendente_aprovacao") {
    stageLog("load_expense", "warn", {
      requestId, expenseId, reason: "invalid_status", currentStatus: (exp as any).status,
    });
    return await respond(409, {
      error: `Despesa não está pendente de aprovação (status atual: ${(exp as any).status}).`,
      stage: "load_expense",
      currentStatus: (exp as any).status,
    });
  }


  const currentLevel = Number((exp as any).current_level_order || 1);
  let levels: Array<{ level_order: number; approver_name: string; approver_email: string | null }> = [];
  if ((exp as any).approval_rule_id) {
    const { data: lvls, error: lvlErr } = await admin
      .from("approval_rule_levels")
      .select("level_order, approver_name, approver_email")
      .eq("rule_id", (exp as any).approval_rule_id)
      .order("level_order", { ascending: true });
    if (lvlErr) {
      stageLog("load_levels", "error", { requestId, expenseId, error: lvlErr.message });
      return await respond(500, {
        error: `Falha ao carregar níveis de aprovação: ${lvlErr.message}`,
        stage: "load_levels",
      });
    }
    levels = (lvls || []) as any;
  }

  const totalLevels = levels.length || 1;
  const isFinalLevel = currentLevel >= totalLevels;
  const currentLevelRow = levels.find((l) => l.level_order === currentLevel) || null;
  stageLog("load_levels", "info", {
    requestId, expenseId, currentLevel, totalLevels, isFinalLevel,
  });


  // ── Authorization ──────────────────────────────────────────────────────
  // The designated approver comes from the rule level. When there's no rule
  // (approver defaults to "Administrador"), only Cloud admins / SAP super
  // users may act.
  const designatedName = currentLevelRow?.approver_name || (exp as any).current_approver || null;
  const designatedEmail = currentLevelRow?.approver_email || null;

  const isOverride = isCloudAdmin || isSuperUser;
  const isMatch = !!callerIdentity && isDesignatedApprover(callerIdentity, designatedName, designatedEmail);

  // ── Substitute-approver check ─────────────────────────────────────────
  // A caller who is not the designated approver may still act if they have
  // an ACTIVE substitution row where they are the substitute for the
  // designated approver (matched by email or email prefix).
  let substitution: {
    id: string;
    official_email: string;
    official_name: string | null;
    granted_by_email: string;
    starts_at: string;
    ends_at: string;
  } | null = null;

  if (!isOverride && !isMatch && callerIdentity) {
    const callerCandidates = [normalize(callerIdentity), normalize(callerEmail || "")].filter(Boolean);
    const officialCandidates = [normalize(designatedEmail || ""), normalize(designatedName || "")]
      .filter(Boolean)
      .flatMap((v) => [v, emailPrefix(v)])
      .filter(Boolean);

    if (callerCandidates.length && officialCandidates.length) {
      const { data: subs } = await admin
        .from("approver_substitutes")
        .select("id, official_email, official_name, substitute_email, granted_by_email, starts_at, ends_at, revoked_at")
        .is("revoked_at", null)
        .lte("starts_at", new Date().toISOString())
        .gte("ends_at", new Date().toISOString());
      const hit = (subs || []).find((s: any) => {
        const subEmail = normalize(s.substitute_email);
        const subPrefix = emailPrefix(subEmail);
        const offEmail = normalize(s.official_email);
        const offPrefix = emailPrefix(offEmail);
        const callerHit = callerCandidates.some(
          (c) => c === subEmail || c === subPrefix || emailPrefix(c) === subPrefix,
        );
        const officialHit = officialCandidates.some(
          (o) => o === offEmail || o === offPrefix || emailPrefix(o) === offPrefix,
        );
        return callerHit && officialHit;
      });
      if (hit) substitution = hit as any;
    }
  }

  if (!isOverride && !isMatch && !substitution) {
    stageLog("authorize", "warn", {
      requestId, expenseId, caller: callerIdentity, designatedName, designatedEmail, currentLevel,
      reason: "not_designated_approver",
    });
    return await respond(403, {
      error: `Você não é o aprovador atribuído deste documento (aprovador atual: ${designatedName || "não definido"}).`,
      stage: "authorize",
      designatedApprover: designatedName,
    });
  }
  stageLog("authorize", "info", {
    requestId, expenseId, caller: callerIdentity, isMatch, isOverride,
    viaSubstitution: !!substitution, substitutionId: substitution?.id ?? null,
  });

  // ── Self-approval guard ───────────────────────────────────────────────
  if (action === "approve") {
    const requesterEmail = normalize((exp as any).requester_email || "");
    const requesterName = normalize((exp as any).requester_name || "");
    const callerNorm = normalize(callerIdentity || "");
    const callerEmailNorm = normalize(callerEmail || "");
    const isSelfApproval =
      (!!requesterEmail &&
        (requesterEmail === callerEmailNorm ||
          requesterEmail === callerNorm ||
          emailPrefix(requesterEmail) === emailPrefix(callerEmailNorm || callerNorm))) ||
      (!!requesterName &&
        (requesterName === callerNorm ||
          emailPrefix(requesterName) === emailPrefix(callerNorm)));
    if (isSelfApproval) {
      stageLog("self_approval_guard", "warn", {
        requestId, expenseId, caller: callerIdentity, requesterEmail, requesterName,
      });
      return await respond(403, {
        error: "Você não pode aprovar um documento que você mesmo criou.",
        stage: "self_approval_guard",
      });
    }
  }


  const actor = callerIdentity || callerEmail || "cloud-admin";
  const actorEmail = callerEmail || (actor.includes("@") ? actor : null);
  const substitutionNote = substitution
    ? `Ação executada por SUBSTITUTO (${actor}) em nome de ${substitution.official_name || substitution.official_email}. Autorização concedida por ${substitution.granted_by_email}, válida de ${substitution.starts_at} a ${substitution.ends_at}.`
    : null;
  const mergedRemarks = substitutionNote
    ? [remarks, substitutionNote].filter(Boolean).join(" — ")
    : remarks;

  // ── Audit log (rastreabilidade) ───────────────────────────────────────
  // Gravado SEMPRE na tabela `expense_audit_log`, além do
  // `expense_approval_log` que alimenta a UI. Captura contexto extra
  // (IP, user-agent, request-id, flags de override/substituição) para
  // auditoria posterior. Falhas ao gravar não bloqueiam a decisão.
  const clientIp =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    null;
  const userAgent = req.headers.get("user-agent") || null;
  const requestId =
    req.headers.get("x-request-id") ||
    req.headers.get("cf-ray") ||
    null;
  const actorSource: "sap" | "cloud_admin" | "unknown" =
    sapValidated ? "sap" : (isCloudAdmin ? "cloud_admin" : "unknown");
  const overrideUsed = (isCloudAdmin || isSuperUser) && !isMatch;

  const writeAuditLog = async (decision: "approved" | "rejected", levelOrder: number) => {
    try {
      await admin.from("expense_audit_log").insert({
        expense_id: expenseId,
        action,
        decision,
        level_order: levelOrder,
        actor_identity: actor,
        actor_email: actorEmail,
        actor_source: actorSource,
        is_cloud_admin: isCloudAdmin,
        is_sap_superuser: isSuperUser,
        override_used: overrideUsed,
        substitution_id: substitution?.id ?? null,
        substituted_for_email: substitution?.official_email ?? null,
        substituted_for_name: substitution?.official_name ?? null,
        reason: remarks,
        remarks: mergedRemarks,
        ip_address: clientIp,
        user_agent: userAgent,
        request_id: requestId,
        idempotency_key: idempotencyKey || null,
        company_db: (exp as any).company_db ?? null,
      } as any);
    } catch (e) {
      console.warn("[expense-approval-action] falha ao gravar audit log:", e);
    }
  };

  // ── Execute ────────────────────────────────────────────────────────────
  if (action === "reject") {
    const updates: Record<string, unknown> = { status: "rejeitado" };
    if (remarks) updates.remarks = remarks;
    const { error: updErr } = await admin.from("expenses").update(updates).eq("id", expenseId);
    if (updErr) {
      stageLog("update_reject", "error", { requestId, expenseId, error: updErr.message });
      return await respond(500, {
        error: `Falha ao rejeitar a despesa: ${updErr.message}`,
        stage: "update_reject",
      });
    }
    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: "rejected",
      approver_name: actor,
      approver_email: actorEmail,
      level_order: currentLevel,
      remarks: mergedRemarks,
      substitution_id: substitution?.id ?? null,
      substituted_for_email: substitution?.official_email ?? null,
      substituted_for_name: substitution?.official_name ?? null,
    } as any);
    await writeAuditLog("rejected", currentLevel);
    stageLog("update_reject", "info", { requestId, expenseId, currentLevel });
    return await respond(200, {
      ok: true,
      action: "reject",
      finalized: true,
      overrideUsed: isOverride && !isMatch,
      expense: {
        id: expenseId,
        requester_name: (exp as any).requester_name,
        requester_email: (exp as any).requester_email,
        supplier_name: (exp as any).supplier_name,
        total_amount: (exp as any).total_amount,
        currency: (exp as any).currency,
        company_db: (exp as any).company_db,
      },
    });
  }


  // action === "approve"
  await admin.from("expense_approval_log").insert({
    expense_id: expenseId,
    decision: "approved",
    approver_name: actor,
    approver_email: actorEmail,
    level_order: currentLevel,
    remarks: mergedRemarks,
    substitution_id: substitution?.id ?? null,
    substituted_for_email: substitution?.official_email ?? null,
    substituted_for_name: substitution?.official_name ?? null,
  } as any);
  await writeAuditLog("approved", currentLevel);

  if (!isFinalLevel) {
    // Self-approval guard: skip any subsequent level whose approver is the
    // requester. If every remaining level matches → Juliana fallback (final).
    const picked = pickApproverSkippingRequester(
      levels as any,
      (exp as any).requester_name,
      (exp as any).requester_email,
      currentLevel + 1,
    );
    const nextLevelOrder = picked.level_order;
    const nextApproverName = picked.approver_name;
    const nextApproverEmail = picked.approver_email;
    const jumped = nextLevelOrder > currentLevel + 1 || picked.fallback_used;

    const updates: Record<string, unknown> = {
      current_level_order: nextLevelOrder,
      current_approver: nextApproverName || null,
    };
    if (remarks) updates.remarks = remarks;
    const { error: updErr } = await admin.from("expenses").update(updates).eq("id", expenseId);
    if (updErr) {
      stageLog("update_advance_level", "error", { requestId, expenseId, nextLevelOrder, error: updErr.message });
      return await respond(500, {
        error: `Falha ao avançar para o próximo nível de aprovação: ${updErr.message}`,
        stage: "update_advance_level",
      });
    }
    stageLog("update_advance_level", "info", {
      requestId, expenseId, from: currentLevel, to: nextLevelOrder, jumped, nextApproverName,
    });

    if (jumped) {
      await admin.from("expense_approval_log").insert({
        expense_id: expenseId,
        decision: "approved",
        approver_name: "Sistema",
        approver_email: null,
        level_order: nextLevelOrder,
        remarks: picked.fallback_used
          ? `Solicitante era o aprovador desta alçada — redirecionado para ${SELF_APPROVAL_FALLBACK.name}.`
          : `Nível(is) pulado(s) automaticamente: solicitante era o aprovador designado.`,
      } as any);
    }

    return await respond(200, {
      ok: true,
      action: "approve",
      finalized: false,
      overrideUsed: isOverride && !isMatch,
      nextApproverName,
      nextApproverEmail,
      currentLevel: nextLevelOrder,
      expense: {
        id: expenseId,
        requester_name: (exp as any).requester_name,
        requester_email: (exp as any).requester_email,
        supplier_name: (exp as any).supplier_name,
        total_amount: (exp as any).total_amount,
        currency: (exp as any).currency,
        company_db: (exp as any).company_db,
      },
    });
  }

  // Final level → mark approved. SAP integration is triggered by the client
  // (it already holds the SAP session and calls `expense-to-sap`).
  const updates: Record<string, unknown> = { status: "aprovado" };
  if (remarks) updates.remarks = remarks;
  const { error: updErr } = await admin.from("expenses").update(updates).eq("id", expenseId);
  if (updErr) {
    stageLog("update_final_approve", "error", { requestId, expenseId, error: updErr.message });
    return await respond(500, {
      error: `Falha ao registrar aprovação final: ${updErr.message}`,
      stage: "update_final_approve",
    });
  }
  stageLog("update_final_approve", "info", { requestId, expenseId, currentLevel });

  return await respond(200, {
    ok: true,
    action: "approve",
    finalized: true,
    overrideUsed: isOverride && !isMatch,
    expense: {
      id: expenseId,
      requester_name: (exp as any).requester_name,
      requester_email: (exp as any).requester_email,
      supplier_name: (exp as any).supplier_name,
      total_amount: (exp as any).total_amount,
      currency: (exp as any).currency,
      company_db: (exp as any).company_db,
    },
  });
});
