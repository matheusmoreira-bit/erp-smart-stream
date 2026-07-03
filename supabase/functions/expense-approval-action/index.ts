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
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: { expense_id?: string; action?: string; remarks?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: "Corpo inválido" }); }

  const expenseId = String(body.expense_id || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const remarks = body.remarks?.toString().trim() || null;
  if (!expenseId) return json(400, { error: "expense_id é obrigatório" });
  if (action !== "approve" && action !== "reject") {
    return json(400, { error: "action deve ser 'approve' ou 'reject'" });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    // No Cloud JWT — fall back to SAP session.
  }

  let sapValidated: Awaited<ReturnType<typeof validateSapSession>> = null;
  if (sapSessionHeader && sapUserHeader && sapCompanyHeader) {
    sapValidated = await validateSapSession(req);
    if (!sapValidated) return json(401, { error: "Sessão SAP inválida ou expirada" });
    // Use SAP user as caller identity when available (matches how the app stores approvers).
    if (!callerIdentity) callerIdentity = sapValidated.userName;
    // Cheap superuser check + mapping check
    try {
      const { data: mappedAdmin } = await admin.rpc("is_sap_user_admin", {
        _sap_username: sapValidated.userName.toLowerCase(),
      });
      if (mappedAdmin === true) isSuperUser = true;
    } catch { /* ignore */ }
    if (!isSuperUser && sapValidated.userName.toLowerCase() === "manager") {
      isSuperUser = true;
    }
    if (!isSuperUser) {
      isSuperUser = await isSapSuperuser(
        admin,
        sapValidated.companyDB,
        sapSessionHeader,
        sapRouteHeader,
        sapValidated.userName,
      );
    }
  }

  if (!callerIdentity && !isCloudAdmin) {
    return json(401, { error: "Não autenticado" });
  }

  // ── Load expense ───────────────────────────────────────────────────────
  const { data: exp, error: expErr } = await admin
    .from("expenses")
    .select("id, approval_rule_id, current_level_order, status, current_approver, requester_name, requester_email, supplier_name, total_amount, currency, company_db")
    .eq("id", expenseId)
    .maybeSingle();
  if (expErr) return json(500, { error: `Falha ao carregar despesa: ${expErr.message}` });
  if (!exp) return json(404, { error: "Despesa não encontrada" });
  if ((exp as any).status !== "pendente_aprovacao") {
    return json(409, { error: `Despesa não está pendente de aprovação (status atual: ${(exp as any).status}).` });
  }

  const currentLevel = Number((exp as any).current_level_order || 1);
  let levels: Array<{ level_order: number; approver_name: string; approver_email: string | null }> = [];
  if ((exp as any).approval_rule_id) {
    const { data: lvls } = await admin
      .from("approval_rule_levels")
      .select("level_order, approver_name, approver_email")
      .eq("rule_id", (exp as any).approval_rule_id)
      .order("level_order", { ascending: true });
    levels = (lvls || []) as any;
  }

  const totalLevels = levels.length || 1;
  const isFinalLevel = currentLevel >= totalLevels;
  const currentLevelRow = levels.find((l) => l.level_order === currentLevel) || null;

  // ── Authorization ──────────────────────────────────────────────────────
  // The designated approver comes from the rule level. When there's no rule
  // (approver defaults to "Administrador"), only Cloud admins / SAP super
  // users may act.
  const designatedName = currentLevelRow?.approver_name || (exp as any).current_approver || null;
  const designatedEmail = currentLevelRow?.approver_email || null;

  const isOverride = isCloudAdmin || isSuperUser;
  const isMatch = !!callerIdentity && isDesignatedApprover(callerIdentity, designatedName, designatedEmail);

  if (!isOverride && !isMatch) {
    console.warn("[expense-approval-action] denied", {
      expenseId,
      caller: callerIdentity,
      designatedName,
      designatedEmail,
      currentLevel,
    });
    return json(403, {
      error: "Você não é o aprovador atribuído deste documento.",
      designatedApprover: designatedName,
    });
  }

  const actor = callerIdentity || callerEmail || "cloud-admin";
  const actorEmail = callerEmail || (actor.includes("@") ? actor : null);

  // ── Execute ────────────────────────────────────────────────────────────
  if (action === "reject") {
    const updates: Record<string, unknown> = { status: "rejeitado" };
    if (remarks) updates.remarks = remarks;
    const { error: updErr } = await admin.from("expenses").update(updates).eq("id", expenseId);
    if (updErr) return json(500, { error: `Falha ao rejeitar: ${updErr.message}` });
    await admin.from("expense_approval_log").insert({
      expense_id: expenseId,
      decision: "rejected",
      approver_name: actor,
      approver_email: actorEmail,
      level_order: currentLevel,
      remarks,
    } as any);
    return json(200, {
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
    remarks,
  } as any);

  if (!isFinalLevel) {
    const nextLevel = levels.find((l) => l.level_order === currentLevel + 1) || null;
    const updates: Record<string, unknown> = {
      current_level_order: currentLevel + 1,
      current_approver: nextLevel?.approver_name || null,
    };
    if (remarks) updates.remarks = remarks;
    const { error: updErr } = await admin.from("expenses").update(updates).eq("id", expenseId);
    if (updErr) return json(500, { error: `Falha ao avançar de nível: ${updErr.message}` });
    return json(200, {
      ok: true,
      action: "approve",
      finalized: false,
      overrideUsed: isOverride && !isMatch,
      nextApproverName: nextLevel?.approver_name || null,
      nextApproverEmail: nextLevel?.approver_email || null,
      currentLevel: currentLevel + 1,
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
  if (updErr) return json(500, { error: `Falha ao aprovar: ${updErr.message}` });

  return json(200, {
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
