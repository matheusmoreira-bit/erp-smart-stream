// One-shot: reatribui todas as ApprovalRequests pendentes de um usuário SAP
// para outro (dentro de uma company_db) e cria notificações in-app para o
// novo aprovador. Apenas admins do backoffice podem invocar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireAdmin, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SapSession { baseUrl: string; session: string; route: string }

function buildBaseUrl(raw: string): string {
  let url = (raw || "").replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, companyDB: string, username: string, password: string): Promise<SapSession> {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: username, Password: password }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Falha login SAP: ${resp.status} ${t.slice(0, 200)}`);
  }
  const cookies = resp.headers.get("set-cookie") || "";
  const session = cookies.match(/B1SESSION=([^;]+)/)?.[1] || "";
  const route = cookies.match(/ROUTEID=([^;]+)/)?.[1] || "";
  if (!session) throw new Error("B1SESSION ausente");
  return { baseUrl, session, route };
}

async function sapLogout(s: SapSession) {
  try {
    await fetch(`${s.baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${s.session}${s.route ? `; ROUTEID=${s.route}` : ""}` },
    });
  } catch { /* noop */ }
}

async function sap(s: SapSession, path: string, method = "GET", body?: unknown) {
  const resp = await fetch(`${s.baseUrl}/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `B1SESSION=${s.session}${s.route ? `; ROUTEID=${s.route}` : ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!resp.ok) {
    const msg = (data as any)?.error?.message?.value || (data as any)?.error?.message || text.slice(0, 300);
    throw new Error(`SAP ${method} ${path} ${resp.status}: ${msg}`);
  }
  return data as any;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let caller;
  try { caller = await requireAdmin(req); }
  catch (e) { return authErrorResponse(e, corsHeaders); }

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body.company_db || "").trim();
    const fromUser = String(body.from_user_code || "").trim().toLowerCase();
    const toUser = String(body.to_user_code || "").trim().toLowerCase();
    const costCenter = String(body.cost_center || "").trim();
    const dryRun = body.dry_run !== false; // default true; require explicit dry_run=false to execute
    const reason = String(body.reason || "Transferência administrativa de aprovações pendentes").slice(0, 500);

    if (!companyDb || !toUser) {
      return new Response(JSON.stringify({ error: "company_db e to_user_code são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!fromUser && !costCenter) {
      return new Response(JSON.stringify({ error: "informe from_user_code e/ou cost_center como filtro" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (fromUser && fromUser === toUser) {
      return new Response(JSON.stringify({ error: "from_user_code e to_user_code devem ser diferentes" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Load SAP credentials for the company
    const { data: credRows, error: credErr } = await sb
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "sap")
      .eq("company_db", companyDb);
    if (credErr) throw new Error(credErr.message);
    const creds: Record<string, string> = {};
    for (const r of credRows || []) if (r.credential_value) creds[r.credential_key] = r.credential_value;
    if (!creds.username || !creds.password || !creds.service_layer_url) {
      throw new Error("Credenciais SAP incompletas para " + companyDb);
    }
    const baseUrl = buildBaseUrl(creds.service_layer_url);
    const sapCompanyDb = (creds.company_db && !/^https?:\/\//i.test(creds.company_db)) ? creds.company_db : companyDb;

    const s = await sapLogin(baseUrl, sapCompanyDb, creds.username, creds.password);
    const results: any = { dryRun, filter: { fromUser: fromUser || null, costCenter: costCenter || null }, transferred: [], skipped: [], errors: [] };

    try {
      // Resolve InternalKey for users (case-insensitive on UserCode)
      const usersResp = await sap(s, "Users?$select=InternalKey,UserCode,UserName,eMail&$top=1000");
      const users: Array<{ InternalKey: number; UserCode: string; UserName?: string; eMail?: string }> = usersResp.value || [];
      const findUser = (code: string) => users.find((u) => (u.UserCode || "").toLowerCase() === code);
      const from = fromUser ? findUser(fromUser) : null;
      const to = findUser(toUser);
      if (fromUser && !from) throw new Error(`Usuário SAP de origem '${fromUser}' não encontrado`);
      if (!to) throw new Error(`Usuário SAP de destino '${toUser}' não encontrado`);
      if (from) results.fromUser = { code: from.UserCode, internalKey: from.InternalKey, email: from.eMail };
      results.toUser = { code: to.UserCode, internalKey: to.InternalKey, email: to.eMail };

      // List pending approval requests. Status: rsPending is the pending queue.
      const reqResp = await sap(
        s,
        "ApprovalRequests?$filter=Status eq 'rsPending'&$select=Code,DocEntry,DocumentType,DraftEntry,OriginatorID,Status&$expand=ApprovalRequestDecisions&$top=500",
      );
      const requests: any[] = reqResp.value || [];

      // Draft cost-center cache to avoid duplicate GETs
      const draftCcCache = new Map<number, string[]>();
      async function draftCostCenters(docEntry: number): Promise<string[]> {
        if (draftCcCache.has(docEntry)) return draftCcCache.get(docEntry)!;
        try {
          const d = await sap(s, `Drafts(${docEntry})?$select=DocumentLines`);
          const lines: any[] = d?.DocumentLines || [];
          const ccs = Array.from(new Set(lines.map((l) => String(l?.CostingCode || "").trim()).filter(Boolean)));
          draftCcCache.set(docEntry, ccs);
          return ccs;
        } catch {
          draftCcCache.set(docEntry, []);
          return [];
        }
      }

      for (const r of requests) {
        try {
          const decisions: any[] = r.ApprovalRequestDecisions || [];
          const pending = decisions.find((d) => d.Status === "asWithoutDecision" || d.Status === "asPending");
          if (!pending) { results.skipped.push({ code: r.Code, reason: "sem decisão pendente" }); continue; }
          if (from && Number(pending.UserID) !== Number(from.InternalKey)) continue;
          if (Number(pending.UserID) === Number(to.InternalKey)) continue; // já é do destino

          if (costCenter) {
            const draftEntry = Number(r.DraftEntry || r.DocEntry);
            const ccs = await draftCostCenters(draftEntry);
            if (!ccs.includes(costCenter)) continue;
          }

          if (dryRun) {
            results.transferred.push({
              code: r.Code, docEntry: r.DocEntry, documentType: r.DocumentType,
              step: pending.ApprovalRequestStep, currentUserID: pending.UserID, wouldSetUserID: to.InternalKey,
            });
            continue;
          }

          await sap(s, `ApprovalRequests(${r.Code})`, "PATCH", {
            ApprovalRequestDecisions: [
              { ApprovalRequestStep: pending.ApprovalRequestStep, UserID: to.InternalKey },
            ],
          });

          const fromLabel = from?.UserCode || `UserID ${pending.UserID}`;
          const reasonSuffix = costCenter ? ` (CC ${costCenter})` : "";

          // Notification for the new approver
          await sb.from("notifications").insert({
            user_identifier: to.UserCode.toLowerCase(),
            title: "Aprovação transferida para você",
            body: `A aprovação ${r.DocumentType ?? ""}${r.DocEntry ? " #" + r.DocEntry : ""} foi transferida para você${reasonSuffix}.`,
            category: "approval",
            company_db: companyDb,
            link: "/aprovacoes",
            metadata: {
              approvalRequestCode: r.Code,
              docEntry: r.DocEntry,
              documentType: r.DocumentType,
              transferredFrom: fromLabel,
              transferredBy: caller.email || caller.id,
              costCenter: costCenter || null,
              reason,
            },
          });

          // Audit trail
          await sb.from("audit_log").insert({
            actor_id: caller.id,
            actor_email: caller.email,
            action: "transfer_approval",
            entity_type: "approval_request",
            entity_id: String(r.Code),
            company_db: companyDb,
            details: {
              docEntry: r.DocEntry, documentType: r.DocumentType,
              from: fromLabel, to: to.UserCode,
              fromInternalKey: pending.UserID, toInternalKey: to.InternalKey,
              costCenter: costCenter || null,
              reason,
            },
          });

          results.transferred.push({
            code: r.Code, docEntry: r.DocEntry, documentType: r.DocumentType,
            step: pending.ApprovalRequestStep, previousUserID: pending.UserID, newUserID: to.InternalKey,
          });
        } catch (e) {
          results.errors.push({ code: r.Code, error: (e as Error).message });
        }
      }
    } finally {
      await sapLogout(s);
    }

    return new Response(JSON.stringify(results), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
