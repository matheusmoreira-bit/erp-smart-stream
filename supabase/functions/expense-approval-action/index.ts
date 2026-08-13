import { withEdgeMetrics } from "../_shared/edge-metrics.ts";
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
import {
  pickApproverSkippingRequester,
  excludeRequesterLevels,
  requesterMatchesApprover,
  SELF_APPROVAL_FALLBACK,
} from "../_shared/approval-skip.ts";
import {
  buildRateioSegments,
  loadRateioSegments,
  persistRateioSegments,
  advanceSegment,
  pendingApproverLabel,
  type SegmentRow,
} from "../_shared/rateio-segments.ts";

import { enforceRateLimit, rateLimitResponse, clientIpFrom } from "../_shared/rate-limit.ts";
import { notifySalesMilestone } from "../_shared/sales-notify.ts";
import { notifyApprovalPending } from "../_shared/approval-notify.ts";
import { notifyActionCompleted } from "../_shared/action-notify.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { resolveCallerAliases, normalizeIdentity } from "../_shared/user-aliases.ts";
import { emailLocalPart, identityMatches, normalizeText, stripDiacritics as baseStripDiacritics, tokenizePerson } from "../_shared/text-normalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const IDEMPOTENCY_IN_FLIGHT_WAIT_MS = 1200;
const IDEMPOTENCY_IN_FLIGHT_POLL_MS = 200;
const IDEMPOTENCY_STALE_MS = 5 * 60 * 1000;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


const normalize = (s: unknown) => normalizeText(s);
const emailPrefix = (email: string) => emailLocalPart(email);
const stripDiacritics = (s: string) => baseStripDiacritics(s);
const tokenize = (s: string) => tokenizePerson(s);

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
    // Contas externas/serviço (.ext) representam a mesma pessoa.
    if (identityMatches(c, ae)) return true;
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
  admin: ReturnType<typeof createClient<any>>,
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

Deno.serve(withEdgeMetrics("expense-approval-action", async (req, _mctx) => {
  const t0 = Date.now();
  const requestId =
    req.headers.get("x-request-id") ||
    req.headers.get("cf-ray") ||
    crypto.randomUUID();

  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
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

  // Rate limit: 12 ações por 60s por (expense × IP) — protege contra spam
  // de aprovação em loop e limita brute force sobre a mesma despesa.
  const rl = await enforceRateLimit(admin, {
    scope: "expense-approval-action",
    identifier: `${expenseId}:${clientIpFrom(req)}`,
    max: 12,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    stageLog("rate_limit", "warn", { requestId, expenseId, retryAfter: rl.retryAfter });
    return rateLimitResponse(rl, corsHeaders);
  }

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
      .select("idempotency_key, expense_id, action, status_code, response, completed_at, created_at")
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
      const priorAgeMs = Date.now() - new Date((prior as any).created_at).getTime();
      if (priorAgeMs <= IDEMPOTENCY_STALE_MS) {
        // Reserva em andamento recente: normalmente é um segundo clique/atalho
        // chegando milissegundos depois do primeiro. Em vez de devolver 409
        // imediatamente, aguardamos brevemente a primeira requisição finalizar
        // e então reentregamos a resposta gravada. Isso preserva a proteção
        // contra duplicidade sem transformar duplo disparo da UI em erro.
        const startedWait = Date.now();
        while (Date.now() - startedWait < IDEMPOTENCY_IN_FLIGHT_WAIT_MS) {
          await sleep(IDEMPOTENCY_IN_FLIGHT_POLL_MS);
          const { data: refreshed, error: refreshErr } = await admin
            .from("expense_action_idempotency")
            .select("status_code, response, completed_at")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (refreshErr) {
            stageLog("idempotency_reserve", "warn", {
              requestId, idempotencyKey, phase: "wait_refresh", error: refreshErr.message,
            });
            break;
          }
          if ((refreshed as any)?.completed_at && (refreshed as any)?.status_code) {
            stageLog("idempotency_replay", "info", {
              requestId,
              idempotencyKey,
              replayedStatus: (refreshed as any).status_code,
              waitedMs: Date.now() - startedWait,
            });
            const cached = (refreshed as any).response ?? { ok: true };
            return json((refreshed as any).status_code, { ...cached, replayed: true, requestId });
          }
        }
        stageLog("idempotency_conflict", "warn", {
          requestId, idempotencyKey, reason: "in_flight", priorAgeMs,
        });
        return json(409, {
          error: "Sua aprovação já está sendo processada. Aguarde alguns segundos antes de tentar novamente.",
          stage: "idempotency_conflict",
          requestId,
          inFlightAgeMs: priorAgeMs,
        });
      }

      // Reserva antiga: o request original provavelmente crashed antes de
      // gravar a resposta — assumimos como stale, apagamos e permitimos a nova
      // tentativa reusar a mesma chave. O cron faz a limpeza definitiva.
      if (priorAgeMs > IDEMPOTENCY_STALE_MS) {
        stageLog("idempotency_reserve", "warn", {
          requestId, idempotencyKey, phase: "takeover_stale", priorAgeMs,
        });
        const { error: delErr } = await admin
          .from("expense_action_idempotency")
          .delete()
          .eq("idempotency_key", idempotencyKey)
          .is("completed_at", null); // safe-guard contra corrida com outra reserva
        if (delErr) {
          stageLog("idempotency_reserve", "error", {
            requestId, idempotencyKey, phase: "takeover_delete", error: delErr.message,
          });
          return json(500, {
            error: `Falha ao recuperar reserva de idempotência travada: ${delErr.message}`,
            stage: "idempotency_reserve",
            requestId,
          });
        }
        // Cai para o INSERT abaixo (código 23505 vira 409 se outra
        // requisição chegar aqui ao mesmo tempo — comportamento correto).
      }
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
      if (isRace) {
        const startedWait = Date.now();
        while (Date.now() - startedWait < IDEMPOTENCY_IN_FLIGHT_WAIT_MS) {
          await sleep(IDEMPOTENCY_IN_FLIGHT_POLL_MS);
          const { data: raced, error: raceLookupErr } = await admin
            .from("expense_action_idempotency")
            .select("status_code, response, completed_at")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (raceLookupErr) {
            stageLog("idempotency_reserve", "warn", {
              requestId, idempotencyKey, phase: "race_lookup", error: raceLookupErr.message,
            });
            break;
          }
          if ((raced as any)?.completed_at && (raced as any)?.status_code) {
            stageLog("idempotency_replay", "info", {
              requestId,
              idempotencyKey,
              replayedStatus: (raced as any).status_code,
              waitedMs: Date.now() - startedWait,
            });
            const cached = (raced as any).response ?? { ok: true };
            return json((raced as any).status_code, { ...cached, replayed: true, requestId });
          }
        }
        return json(409, {
          error: "Sua aprovação já está sendo processada. Aguarde alguns segundos antes de tentar novamente.",
          stage: "idempotency_conflict",
          requestId,
        });
      }
      return json(isRace ? 409 : 500, {
        error: `Falha ao reservar chave de idempotência: ${reserveErr.message}`,
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

  // Chamada interna server-to-server (link assinado de e-mail/Slack).
  // Só é aceita quando o Authorization traz a service role key — nunca
  // exposta ao browser — e informa em nome de quem a ação é executada.
  const internalActorEmail = req.headers.get("x-internal-actor-email")?.trim().toLowerCase() || "";
  let internalActor = false;
  if (internalActorEmail) {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (serviceKey && bearer === serviceKey) {
      internalActor = true;
      callerEmail = internalActorEmail;
      callerIdentity = internalActorEmail;
      stageLog("auth_cloud", "info", { requestId, callerEmail, internalActor: true });
    } else {
      stageLog("auth_cloud", "warn", { requestId, note: "internal_actor_header_without_service_key" });
      return await respond(401, { error: "Não autorizado.", stage: "auth_cloud" });
    }
  }

  // Try Cloud JWT first (admins may act on any document).
  if (!internalActor) try {
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
      // Sessão SAP expirada NÃO deve bloquear a aprovação quando já existe
      // outra identidade válida (JWT do Cloud / ator interno). A aprovação é
      // uma operação do ERP Flow — o SAP só é necessário na integração.
      if (callerIdentity || callerEmail || isCloudAdmin) {
        stageLog("auth_sap", "warn", {
          requestId, reason: "expired_session_ignored_cloud_identity", sapUser: sapUserHeader,
        });
      } else {
        stageLog("auth_sap", "warn", { requestId, reason: "invalid_or_expired_session", sapUser: sapUserHeader });
        return await respond(401, {
          error: "Sessão SAP inválida ou expirada. Faça login novamente.",
          stage: "auth_sap",
        });
      }
    }
  }
  if (sapValidated) {

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
    // NOTE: expensive SAP `Users` fetch is deferred — see lazy check below.
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
    .select("id, approval_rule_id, current_level_order, status, current_approver, requester_name, requester_email, supplier_name, supplier_code, cost_center, project, total_amount, currency, company_db, doc_type, rateio_type, sap_doc_entry, origin")
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

  // RATEIO: quando as linhas pertencem a alçadas diferentes (CC/projeto
  // distintos), CADA segmento segue a sua própria cadeia, de forma
  // INDEPENDENTE. O documento só é aprovado quando todos os segmentos
  // concluírem. Não há mescla de cadeias.
  let segmentRows: SegmentRow[] = [];
  try {
    segmentRows = await loadRateioSegments(admin, expenseId);
    if (segmentRows.length === 0) {
      // Backfill para documentos criados antes dos fluxos por segmento.
      const { data: rateioItems } = await admin
        .from("expense_items")
        .select("cost_center, project, line_total")
        .eq("expense_id", expenseId);
      const segs = await buildRateioSegments(admin, (rateioItems || []) as any, {
        companyDb: String((exp as any).company_db || ""),
        docType: String((exp as any).doc_type || "purchase"),
        currency: (exp as any).currency || "BRL",
        requesterName: (exp as any).requester_name || null,
        supplierName: (exp as any).supplier_name || null,
        supplierCode: (exp as any).supplier_code || null,
        headerCostCenter: (exp as any).cost_center || null,
        headerProject: (exp as any).project || null,
        rateioType: String((exp as any).rateio_type || "padrao").toLowerCase(),
      });
      if (segs && segs.length > 0) {
        segmentRows = await persistRateioSegments(
          admin, expenseId, segs,
          (exp as any).requester_name || null, (exp as any).requester_email || null,
        );
      }
    }
    if (segmentRows.length > 0) {
      stageLog("rateio_segments", "info", {
        requestId, expenseId,
        segments: segmentRows.map((s) => `${s.segment_key}@${s.current_level}:${s.current_approver}:${s.status}`),
      });
    }
  } catch (e) {
    stageLog("rateio_segments", "warn", { requestId, expenseId, error: String((e as Error)?.message || e) });
  }
  const pendingSegments = segmentRows.filter((s) => s.status === "pendente");
  const segmentMode = pendingSegments.length > 0;

  // Suporte a APROVADORES PARALELOS: múltiplas linhas podem compartilhar
  // o mesmo `level_order` (o primeiro que decidir encerra o nível).
  const distinctLevels = Array.from(new Set(levels.map((l) => l.level_order))).sort((a, b) => a - b);
  const totalLevels = distinctLevels.length || 1;
  const maxLevelOrder = distinctLevels.length > 0 ? distinctLevels[distinctLevels.length - 1] : 1;
  const isFinalLevel = currentLevel >= maxLevelOrder;
  const currentLevelRows = levels.filter((l) => l.level_order === currentLevel);
  const currentLevelRow = currentLevelRows[0] || null;
  stageLog("load_levels", "info", {
    requestId, expenseId, currentLevel, totalLevels, isFinalLevel,
    parallelAtCurrent: currentLevelRows.length, segmentMode,
  });


  // ── Authorization ──────────────────────────────────────────────────────
  // Regra: `expenses.current_approver` é fonte de verdade quando presente —
  // isso permite delegação (reatribuição do aprovador atual) sem alterar a
  // regra global. Só cai para o nível da regra quando não houver override.
  // Em modo SEGMENTO, os alvos são os aprovadores pendentes de cada segmento.
  const overrideApprover = ((exp as any).current_approver as string | null) || null;
  const overrideIsEmail = !!overrideApprover && overrideApprover.includes("@");

  // Casa contra QUALQUER linha do nível atual (paralelo). Se houver override
  // (delegação), o nome/email do override toma precedência.
  // O SOLICITANTE nunca é alvo válido: se ele consta no nível, a aprovação
  // dele é escalada (os demais aprovadores do nível/próximo nível decidem).
  const requesterIdName = ((exp as any).requester_name as string | null) || null;
  const requesterIdEmail = ((exp as any).requester_email as string | null) || null;
  const currentLevelRowsNoSelf = excludeRequesterLevels(
    currentLevelRows as any,
    requesterIdName,
    requesterIdEmail,
  );
  const designatedTargets: Array<{ name: string | null; email: string | null }> = segmentMode
    ? pendingSegments
        .map((s) => ({ name: s.current_approver, email: s.current_approver_email }))
        .filter((t) => !requesterMatchesApprover(requesterIdName, requesterIdEmail, t.name, t.email))
    : (overrideApprover
      ? [{
          name: overrideIsEmail ? null : overrideApprover,
          email: overrideIsEmail ? overrideApprover : null,
        }].filter((t) => !requesterMatchesApprover(requesterIdName, requesterIdEmail, t.name, t.email))
      : currentLevelRowsNoSelf.map((row) => ({ name: row.approver_name, email: row.approver_email })));


  let isMatch = !!callerIdentity && designatedTargets.some((t) =>
    isDesignatedApprover(callerIdentity as string, t.name, t.email),
  );

  // Aliases do caller (idp_user_mapping, sap_user_emails, credenciais SAP,
  // collaborator_profiles). Resolvemos SEMPRE porque também são usados para
  // detectar que o mesmo aprovador aparece em mais de um fluxo do documento.
  let callerAliases = new Set<string>();
  try {
    callerAliases = await resolveCallerAliases(admin, {
      email: callerEmail || undefined,
      userName: sapValidated?.userName || (callerIdentity && !callerIdentity.includes("@") ? callerIdentity : undefined),
    });
  } catch (e) {
    stageLog("authorize", "warn", { requestId, phase: "alias_resolution", error: (e as Error).message });
  }

  /**
   * O caller é a pessoa designada em `name`/`email`?
   * Usado tanto na autorização quanto na propagação da aprovação para os
   * demais fluxos do mesmo documento (evita aprovar duas vezes).
   */
  const callerIsApprover = (name: string | null, email: string | null): boolean => {
    if (!!callerIdentity && isDesignatedApprover(callerIdentity as string, name, email)) return true;
    const cands = [normalizeIdentity(email), normalizeIdentity(name)].filter(Boolean);
    return cands.some((c) => callerAliases.has(c as string));
  };

  // Fallback por ALIASES: o e-mail de login pode não ter relação textual com
  // o nome do aprovador (ex.: k@banana.games ↔ "Kainnan Pitano").
  if (!isMatch && callerAliases.size > 0) {
    const aliasHit = designatedTargets.some((t) => {
      const cands = [normalizeIdentity(t.email), normalizeIdentity(t.name)].filter(Boolean);
      return cands.some((c) => callerAliases.has(c as string));
    });
    if (aliasHit) {
      isMatch = true;
      stageLog("authorize", "info", { requestId, expenseId, reason: "matched_by_alias" });
    }
  }



  // Lazy SAP superuser check — só faz a chamada cara ao SAP quando o
  // caller NÃO é o aprovador designado e ainda não sabemos que é admin.
  // Isso economiza ~5s em cada aprovação do fluxo normal.
  if (!isCloudAdmin && !isSuperUser && !isMatch && sapValidated) {
    isSuperUser = await isSapSuperuser(
      admin, sapValidated.companyDB, sapSessionHeader, sapRouteHeader, sapValidated.userName,
    );
    stageLog("auth_sap", "info", {
      requestId, phase: "lazy_superuser_check", isSuperUser,
    });
  }

  const isOverride = isCloudAdmin || isSuperUser;


  // Compat: para os blocos que rodam depois (logs, substitutos), continuamos
  // expondo um "designatedName/Email" — usamos a primeira linha do nível.
  const designatedName = overrideApprover || currentLevelRow?.approver_name || null;
  const designatedEmail = overrideIsEmail
    ? overrideApprover
    : (currentLevelRow?.approver_email || null);

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
        .select("id, official_email, official_name, substitute_email, substitute_name, granted_by_email, starts_at, ends_at, revoked_at")
        .is("revoked_at", null)
        .lte("starts_at", new Date().toISOString())
        .gte("ends_at", new Date().toISOString());
      const hit = (subs || []).find((s: any) => {
        // Aceita grant cadastrado por e-mail OU por nome (titular e substituto).
        const subKeys = [normalize(s.substitute_email), normalize(s.substitute_name)]
          .filter(Boolean)
          .flatMap((v) => [v, emailPrefix(v)])
          .filter(Boolean);
        const offKeys = [normalize(s.official_email), normalize(s.official_name)]
          .filter(Boolean)
          .flatMap((v) => [v, emailPrefix(v)])
          .filter(Boolean);
        const callerHit = callerCandidates.some(
          (c) => subKeys.includes(c) || subKeys.includes(emailPrefix(c)),
        );
        const officialHit = officialCandidates.some(
          (o) => offKeys.includes(o) || offKeys.includes(emailPrefix(o)),
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
  // requestId já foi definido no topo do handler (linha ~155).
  const actorSource: "sap" | "cloud_admin" | "unknown" =
    sapValidated ? "sap" : (isCloudAdmin ? "cloud_admin" : "unknown");
  const overrideUsed = (isCloudAdmin || isSuperUser) && !isMatch;

  // Papel do ator no momento da decisão — usado por auditoria e UI de
  // histórico ("quem aprovou e com qual papel"):
  //   - substitute      → agiu via approver_substitute vigente
  //   - admin_override  → agiu como Cloud admin/SAP superuser sem ser o
  //                       aprovador designado (override explícito)
  //   - approver        → aprovador designado do nível corrente (inclui
  //                       delegações do SAP, que reatribuem o approver)
  const actionRole: "substitute" | "admin_override" | "approver" = substitution
    ? "substitute"
    : (overrideUsed ? "admin_override" : "approver");

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
        action_role: actionRole,
      } as any);
    } catch (e) {
      console.warn("[expense-approval-action] falha ao gravar audit log:", e);
    }
  };

  // ── Execute ────────────────────────────────────────────────────────────
  if (action === "reject") {
    // Rótulo humano de cada trilha (padrão x reembolso) para o motivo
    // consolidado.
    const segLabel = (s: SegmentRow) =>
      s.segment_key === "__reembolso__"
        ? "Trilha de reembolso"
        : `Trilha padrão ${s.cost_center || "—"} / ${s.project || "—"}`;

    // Quais trilhas o caller de fato reprova (as demais ficam BLOQUEADAS
    // pela reprovação — o documento inteiro para).
    const rejectedSegs = segmentRows.length > 0
      ? (pendingSegments.filter((s) => callerIsApprover(s.current_approver, s.current_approver_email)).length > 0
        ? pendingSegments.filter((s) => callerIsApprover(s.current_approver, s.current_approver_email))
        : pendingSegments)
      : [];
    const rejectedIds = new Set(rejectedSegs.map((s) => s.id));

    // Decisões já registradas nas outras trilhas (aprovações/reprovações
    // anteriores) entram no motivo consolidado.
    const { data: priorLogs } = await admin
      .from("expense_approval_log")
      .select("decision, approver_name, level_order, remarks, created_at")
      .eq("expense_id", expenseId)
      .order("created_at", { ascending: true });

    const parts: string[] = [];
    parts.push(`REPROVADO por ${actor}${remarks ? `: ${remarks}` : "."}`);
    if (segmentRows.length > 0) {
      for (const s of segmentRows) {
        if (rejectedIds.has(s.id)) {
          parts.push(`• ${segLabel(s)} — REPROVADA por ${actor} (nível ${s.current_level})${remarks ? `: ${remarks}` : ""}`);
        } else if (s.status === "pendente") {
          parts.push(`• ${segLabel(s)} — BLOQUEADA (aguardava ${s.current_approver || "aprovador"} no nível ${s.current_level}; parada pela reprovação acima)`);
        } else if (String(s.status) === "rejeitado") {
          parts.push(`• ${segLabel(s)} — já REPROVADA por ${s.decided_by || "—"}`);
        } else {
          parts.push(`• ${segLabel(s)} — ${String(s.status).toUpperCase()}${s.decided_by ? ` por ${s.decided_by}` : ""} (sem efeito: documento reprovado)`);
        }
      }
    }
    for (const l of (priorLogs || []) as Array<any>) {
      if (l.decision === "rejected" && l.remarks) {
        parts.push(`• Reprovação anterior (nível ${l.level_order}) por ${l.approver_name || "—"}: ${l.remarks}`);
      }
    }
    const consolidatedReason = parts.join("\n");

    const updates: Record<string, unknown> = { status: "rejeitado", remarks: consolidatedReason };
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
      action_role: actionRole,
    } as any);
    await writeAuditLog("rejected", currentLevel);
    if (segmentRows.length > 0) {
      // Reprovação encerra o documento inteiro — TODAS as trilhas param
      // (padrão e reembolso), cada uma com o seu registro de motivo.
      const nowIso = new Date().toISOString();
      if (rejectedIds.size > 0) {
        await admin.from("expense_approval_segments").update({
          status: "rejeitado",
          current_approver: null,
          current_approver_email: null,
          decided_by: actor,
          decided_at: nowIso,
          resolution_note: `Reprovada por ${actor}${remarks ? `: ${remarks}` : ""}`,
        }).in("id", Array.from(rejectedIds));
      }
      await admin.from("expense_approval_segments").update({
        status: "bloqueado",
        current_approver: null,
        current_approver_email: null,
        decided_by: actor,
        decided_at: nowIso,
        resolution_note: `Bloqueada: documento reprovado em outra trilha por ${actor}${remarks ? `: ${remarks}` : ""}`,
      }).eq("expense_id", expenseId).eq("status", "pendente");
    }


    // Fluxo paralelo: avisa o solicitante do desfecho da ação pedida.
    await notifyActionCompleted(admin, {
      actionKey: "approval",
      refId: `${expenseId}:rejected`,
      recipient: (exp as any).requester_email || (exp as any).requester_name,
      companyDb: (exp as any).company_db,
      title: "Seu documento foi reprovado",
      summary: `A aprovação solicitada foi concluída por ${actor} com decisão de reprovação.`,
      link: "/aprovacoes?tab=history",
      details: [
        { label: "Fornecedor/Cliente", value: (exp as any).supplier_name },
        { label: "Valor", value: `${(exp as any).currency || "BRL"} ${Number((exp as any).total_amount || 0).toFixed(2)}` },
        { label: "Empresa", value: (exp as any).company_db },
        { label: "Motivo", value: remarks || null },
        { label: "Motivo consolidado (todas as trilhas)", value: consolidatedReason },
      ],
    });

    stageLog("update_reject", "info", { requestId, expenseId, currentLevel });
    return await respond(200, {
      ok: true,
      action: "reject",
      finalized: true,
      consolidatedReason,
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
    action_role: actionRole,
  } as any);
  await writeAuditLog("approved", currentLevel);

  // ── RATEIO: aprovação por SEGMENTO (fluxos independentes) ──────────────
  if (segmentMode) {
    const reqName = (exp as any).requester_name || null;
    const reqEmail = (exp as any).requester_email || null;
    // Todos os fluxos pendentes em que o caller é o aprovador atual — mesmo
    // que a identidade só case por alias. Uma única ação aprova TODOS eles.
    const mine = pendingSegments.filter((s) => callerIsApprover(s.current_approver, s.current_approver_email));
    // Admin/superusuário/substituto sem casar textualmente → aprova todos os
    // segmentos pendentes (override explícito).
    const targets = mine.length > 0 ? mine : pendingSegments;

    const advancedNotifications: Array<{ name: string | null; email: string | null; level: number; seg: SegmentRow }> = [];
    const autoApproved: string[] = [];
    for (const seg of targets) {
      let cursor: SegmentRow = seg;
      let next = advanceSegment(cursor, reqName, reqEmail);
      // CASCATA: se o próximo nível do MESMO fluxo também é o caller, já
      // registramos a aprovação dele — ninguém aprova o mesmo documento duas
      // vezes. Limite defensivo para cadeias mal formadas.
      for (let hop = 0; hop < 20 && !next.finished && callerIsApprover(next.current_approver, next.current_approver_email); hop++) {
        await admin.from("expense_approval_log").insert({
          expense_id: expenseId,
          decision: "approved",
          approver_name: actor,
          approver_email: actorEmail,
          level_order: next.current_level,
          remarks: `${mergedRemarks ? `${mergedRemarks} — ` : ""}Aprovação replicada automaticamente (mesmo aprovador no nível ${next.current_level} do fluxo ${cursor.cost_center || "—"} / ${cursor.project || "—"})`,
          substitution_id: substitution?.id ?? null,
          substituted_for_email: substitution?.official_email ?? null,
          substituted_for_name: substitution?.official_name ?? null,
          action_role: actionRole,
        } as any);
        await writeAuditLog("approved", next.current_level);
        autoApproved.push(`${cursor.segment_key}@${next.current_level}`);
        cursor = { ...cursor, current_level: next.current_level } as SegmentRow;
        next = advanceSegment(cursor, reqName, reqEmail);
      }
      await admin.from("expense_approval_segments").update({
        status: next.status,
        current_level: next.current_level,
        current_approver: next.current_approver,
        current_approver_email: next.current_approver_email,
        decided_by: actor,
        decided_at: new Date().toISOString(),
      }).eq("id", seg.id);
      if (!next.finished) {
        advancedNotifications.push({
          name: next.current_approver, email: next.current_approver_email, level: next.current_level, seg,
        });
      }
    }
    if (autoApproved.length > 0) {
      stageLog("rateio_segments", "info", { requestId, expenseId, autoApprovedSameApprover: autoApproved });
    }


    const after = await loadRateioSegments(admin, expenseId);
    const stillPending = after.filter((s) => s.status === "pendente");
    stageLog("rateio_segments", "info", {
      requestId, expenseId, approvedSegments: targets.map((t) => t.segment_key),
      stillPending: stillPending.map((s) => `${s.segment_key}:${s.current_approver}`),
    });

    if (stillPending.length > 0) {
      const label = pendingApproverLabel(after);
      const minLevel = Math.min(...stillPending.map((s) => Number(s.current_level) || 1));
      const updates: Record<string, unknown> = {
        current_approver: label,
        current_level_order: minLevel,
      };
      if (remarks) updates.remarks = remarks;
      const { error: headerErr } = await admin.from("expenses").update(updates).eq("id", expenseId);
      if (headerErr) {
        // O cabeçalho é o que a tela de aprovações lê: se ele não avançar, o
        // documento fica "travado" no aprovador anterior mesmo com os
        // segmentos já aprovados. Tenta de novo sem campos opcionais.
        stageLog("update_advance_level", "error", {
          requestId, expenseId, phase: "segment_header_update", error: headerErr.message,
        });
        const { error: retryErr } = await admin
          .from("expenses")
          .update({ current_approver: label, current_level_order: minLevel })
          .eq("id", expenseId);
        if (retryErr) {
          stageLog("update_advance_level", "error", {
            requestId, expenseId, phase: "segment_header_update_retry", error: retryErr.message,
          });
        }
      }


      for (const n of advancedNotifications) {
        await notifyApprovalPending(admin, {
          expenseId,
          companyDb: (exp as any).company_db,
          approverEmail: n.email,
          approverName: n.name,
          levelOrder: n.level,
          requesterName: (exp as any).requester_name,
          supplierName: (exp as any).supplier_name,
          totalAmount: Number(n.seg.amount || (exp as any).total_amount || 0),
          currency: (exp as any).currency,
          docType: String((exp as any).doc_type || "purchase"),
          resolution: {
            source: "next_level",
            reason: `Próximo nível da alçada do segmento ${n.seg.cost_center || "—"} / ${n.seg.project || "—"}`,
            ruleId: n.seg.rule_id,
            costCenter: n.seg.cost_center,
            project: n.seg.project,
            metadata: { segment: n.seg.segment_key, independent_chain: true },
          },
        });
      }

      return await respond(200, {
        ok: true,
        action: "approve",
        finalized: false,
        overrideUsed: isOverride && !isMatch,
        nextApproverName: stillPending[0]?.current_approver || null,
        nextApproverEmail: stillPending[0]?.current_approver_email || null,
        currentLevel: minLevel,
        pendingSegments: stillPending.map((s) => ({
          cost_center: s.cost_center, project: s.project, approver: s.current_approver, level: s.current_level,
        })),
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
    // Todos os segmentos aprovados → segue para a finalização normal abaixo.
  }

  // ── CASCATA: mesmo aprovador em níveis seguintes da mesma cadeia ───────
  // Se o próximo nível (ou os seguintes) tem o MESMO aprovador que acabou de
  // decidir, registramos a aprovação dele automaticamente — ninguém precisa
  // aprovar o mesmo documento duas vezes.
  let effectiveLevel = currentLevel;
  let cascadeFinal = isFinalLevel;
  if (!segmentMode && !isFinalLevel) {
    for (let hop = 0; hop < 20; hop++) {
      const nd = distinctLevels.find((lo) => lo > effectiveLevel);
      if (nd === undefined) { cascadeFinal = true; break; }
      const p = pickApproverSkippingRequester(
        levels as any, (exp as any).requester_name, (exp as any).requester_email, nd,
      );
      if (!callerIsApprover(p.approver_name, p.approver_email)) break;
      await admin.from("expense_approval_log").insert({
        expense_id: expenseId,
        decision: "approved",
        approver_name: actor,
        approver_email: actorEmail,
        level_order: p.level_order,
        remarks: `${mergedRemarks ? `${mergedRemarks} — ` : ""}Aprovação replicada automaticamente (mesmo aprovador no nível ${p.level_order})`,
        substitution_id: substitution?.id ?? null,
        substituted_for_email: substitution?.official_email ?? null,
        substituted_for_name: substitution?.official_name ?? null,
        action_role: actionRole,
      } as any);
      await writeAuditLog("approved", p.level_order);
      effectiveLevel = p.level_order;
      stageLog("cascade_same_approver", "info", { requestId, expenseId, level: p.level_order });
      if (effectiveLevel >= maxLevelOrder) { cascadeFinal = true; break; }
    }
  }

  if (!segmentMode && !cascadeFinal) {

    // Próximo nível DISTINTO (paralelo: várias linhas com o mesmo level_order
    // contam como 1 só nível). Self-approval guard continua valendo.
    const nextDistinct = distinctLevels.find((lo) => lo > effectiveLevel) || (effectiveLevel + 1);

    const picked = pickApproverSkippingRequester(
      levels as any,
      (exp as any).requester_name,
      (exp as any).requester_email,
      nextDistinct,
    );
    const nextLevelOrder = picked.level_order;
    const nextApproverName = picked.approver_name;
    const nextApproverEmail = picked.approver_email;
    const jumped = nextLevelOrder > nextDistinct || picked.fallback_used;

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

    // Notifica o próximo aprovador nos canais ativos (in-app, e-mail, Slack).
    await notifyApprovalPending(admin, {
      expenseId,
      companyDb: (exp as any).company_db,
      approverEmail: nextApproverEmail,
      approverName: nextApproverName,
      levelOrder: nextLevelOrder,
      requesterName: (exp as any).requester_name,
      supplierName: (exp as any).supplier_name,
      totalAmount: Number((exp as any).total_amount || 0),
      currency: (exp as any).currency,
      docType: String((exp as any).doc_type || "purchase"),
      resolution: {
        source: picked.fallback_used ? "self_approval_escalation" : "next_level",
        reason: picked.fallback_used
          ? "Solicitante era o aprovador deste nível — redirecionado para o aprovador de contingência"
          : `Próximo nível da cadeia de alçada (nível ${nextLevelOrder}) após aprovação anterior`,
        ruleId: (exp as any).approval_rule_id || null,
        costCenter: (exp as any).cost_center || null,
        project: (exp as any).project || null,
        metadata: { jumped, fallback_used: picked.fallback_used },
      },
    });




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

  // Fluxo paralelo: avisa o solicitante que a ação pedida foi concluída.
  await notifyActionCompleted(admin, {
    actionKey: "approval",
    refId: `${expenseId}:approved`,
    recipient: (exp as any).requester_email || (exp as any).requester_name,
    companyDb: (exp as any).company_db,
    title: "Seu documento foi aprovado",
    summary: `A aprovação solicitada foi concluída por ${actor}.`,
    link: "/aprovacoes?tab=history",
    details: [
      { label: String((exp as any).doc_type) === "sales" ? "Cliente" : "Fornecedor", value: (exp as any).supplier_name },
      { label: "Valor", value: `${(exp as any).currency || "BRL"} ${Number((exp as any).total_amount || 0).toFixed(2)}` },
      { label: "Empresa", value: (exp as any).company_db },
      { label: "Aprovador", value: actor },
    ],
  });

  // Pedido de COMPRA que já existe no SAP e foi editado + reaprovado no Flow:
  // reenvia em modo PATCH para refletir a alteração no ERP. Antes essa etapa
  // dependia do cliente, que apenas registrava "já existe no ERP" e parava —
  // a alteração nunca chegava ao SAP.
  if (String((exp as any).doc_type) !== "sales" && (exp as any).sap_doc_entry) {
    const originStr = String((exp as any).origin || "").toLowerCase();
    const nativeErp = ["sap", "erp", "sap_erp"].includes(originStr);
    if (!nativeErp) {
      try {
        const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const svcUrl = Deno.env.get("SUPABASE_URL") || "";
        const sapRes = await fetch(`${svcUrl}/functions/v1/expense-to-sap`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${svcKey}`,
            apikey: svcKey,
            "x-internal-retry": "1",
          },
          body: JSON.stringify({
            expense_id: expenseId,
            patch_document: true,
            use_service_account: true,
          }),
        });
        const sapBody = await sapRes.json().catch(() => ({}));
        stageLog("purchase_to_sap_patch", sapRes.ok ? "info" : "error", {
          requestId,
          expenseId,
          status: sapRes.status,
          docEntry: (sapBody as any)?.docEntry ?? null,
          error: (sapBody as any)?.error ?? null,
        });
      } catch (e) {
        stageLog("purchase_to_sap_patch", "error", { requestId, expenseId, error: (e as Error).message });
      }
    }
  }

  if (String((exp as any).doc_type) === "sales") {
    // Pedido de venda aprovado no ERP Flow → integra ao SAP (Orders) usando o
    // Apiuser da empresa. Não depende da sessão SAP do aprovador.
    {
      // Se o pedido já existe no SAP, reenviamos em modo PATCH para refletir
      // ajustes feitos no Flow (valores, itens, CC/projeto) após a reaprovação.
      const alreadyInSap = !!(exp as any).sap_doc_entry;
      try {
        const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const svcUrl = Deno.env.get("SUPABASE_URL") || "";
        const sapRes = await fetch(`${svcUrl}/functions/v1/expense-to-sap`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${svcKey}`,
            apikey: svcKey,
            "x-internal-retry": "1",
          },
          body: JSON.stringify({ expense_id: expenseId, patch_document: alreadyInSap }),
        });
        const sapBody = await sapRes.json().catch(() => ({}));
        stageLog(alreadyInSap ? "sales_to_sap_patch" : "sales_to_sap", sapRes.ok ? "info" : "error", {
          requestId,
          expenseId,
          status: sapRes.status,
          docEntry: (sapBody as any)?.doc_entry ?? null,
          error: (sapBody as any)?.error ?? null,
        });
      } catch (e) {
        stageLog("sales_to_sap", "error", { requestId, expenseId, error: (e as Error).message });
      }
    }

    await notifySalesMilestone(admin, {
      milestone: "approved",
      companyDb: (exp as any).company_db,
      refId: expenseId,
      link: "/vendas/pedidos",
      summary: "Um pedido de venda foi aprovado e está pronto para emissão de NFS-e.",
      details: [
        { label: "Cliente", value: (exp as any).supplier_name },
        { label: "Valor", value: `${(exp as any).currency || "BRL"} ${Number((exp as any).total_amount || 0).toFixed(2)}` },
        { label: "Empresa", value: (exp as any).company_db },
        { label: "Solicitante", value: (exp as any).requester_name },
      ],
    });
  }

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
}));
