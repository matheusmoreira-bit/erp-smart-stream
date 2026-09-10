// Edge function: consulta no SAP B1 o status real de adiantamentos já integrados
// e sincroniza número, data e situação do documento no ERP Flow.
// POST /functions/v1/advance-sap-status
//   body: { advance_id: string } | { company_db: string, advance_type?: "customer" | "supplier", limit?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUserOrSapSession } from "../_shared/auth.ts";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getSapCreds(supabase: ReturnType<typeof createClient>, companyDb: string) {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Erro credenciais SAP: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Credenciais SAP não configuradas");
  const out: Record<string, string> = {};
  for (const r of data as any[]) out[r.credential_key] = r.credential_value;
  return out;
}

function getSapBaseUrl(creds: Record<string, string>) {
  let url = (creds.service_layer_url || creds.base_url || creds.url || "").replace(/\/+$/, "");
  if (!url) throw new Error("URL do SAP B1 não configurada");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function sapLogin(baseUrl: string, creds: Record<string, string>, companyDb: string) {
  const user = creds.username || creds.apiuser;
  const pwd = creds.password || creds.apipassword;
  if (!user || !pwd) throw new Error("Credenciais admin SAP ausentes (username/password).");
  const res = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ UserName: user, Password: pwd, CompanyDB: companyDb }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SAP Login failed: ${body?.error?.message?.value || res.status}`);
  const setCookie = res.headers.get("set-cookie") || "";
  const routeMatch = /ROUTEID=([^;]+)/.exec(setCookie);
  return `B1SESSION=${body.SessionId}${routeMatch?.[1] ? `; ROUTEID=${routeMatch[1]}` : ""}`;
}

Deno.serve(async (req) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  { const _pause = await getIntegrationPause("sap_b1"); if (_pause) return pauseResponse(_pause, corsHeaders); }

  try {
    await requireUserOrSapSession(req);
  } catch {
    return json({ success: false, error: "Faça login no SAP pela tela antes de sincronizar." }, 401);
  }

  let cookies: string | null = null;
  let baseUrl = "";
  try {
    const body = await req.json().catch(() => ({}));
    const advanceId: string | undefined = typeof body.advance_id === "string" ? body.advance_id : undefined;
    const companyDbIn: string | undefined = typeof body.company_db === "string" ? body.company_db : undefined;
    const advanceType = body.advance_type === "supplier" ? "supplier" : body.advance_type === "customer" ? "customer" : null;
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 300);

    if (!advanceId && !companyDbIn) {
      return json({ success: false, error: "Informe advance_id ou company_db." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase
      .from("advance_payments")
      .select("id, company_db, advance_type, sap_doc_entry, amount")
      .not("sap_doc_entry", "is", null);
    if (advanceId) query = query.eq("id", advanceId);
    if (companyDbIn) query = query.eq("company_db", companyDbIn);
    if (advanceType) query = query.eq("advance_type", advanceType);
    query = query.order("sap_integrated_at", { ascending: false }).limit(limit);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return json({ success: true, synced: 0, results: [] });

    const companyDb = String((rows as any[])[0].company_db);
    // Não permite misturar empresas numa mesma chamada.
    const filtered = (rows as any[]).filter((r) => r.company_db === companyDb);

    const headerCompany = req.headers.get("x-company-db");
    if (headerCompany && headerCompany !== companyDb) {
      return json({ success: false, error: "Empresa da sessão não corresponde ao adiantamento." }, 403);
    }

    const creds = await getSapCreds(supabase, companyDb);
    baseUrl = getSapBaseUrl(creds);
    cookies = await sapLogin(baseUrl, creds, companyDb);

    const results: Record<string, unknown>[] = [];
    for (const row of filtered) {
      const endpoint = row.advance_type === "customer" ? "DownPayments" : "PurchaseDownPaymentInvoices";
      const url = `${baseUrl}/${endpoint}(${Number(row.sap_doc_entry)})?$select=DocEntry,DocNum,DocDate,DocumentStatus,Cancelled,DocTotal,PaidToDate`;
      const res = await fetch(url, { headers: { Cookie: cookies } });
      const doc = await res.json().catch(() => ({}));
      if (!res.ok) {
        results.push({ id: row.id, ok: false, error: doc?.error?.message?.value || `HTTP ${res.status}` });
        continue;
      }
      const cancelled = doc.Cancelled === "tYES";
      const docTotal = Number(doc.DocTotal ?? row.amount ?? 0);
      const paid = Number(doc.PaidToDate ?? 0);
      const open = Math.max(docTotal - paid, 0);
      const update: Record<string, unknown> = {
        sap_doc_num: doc.DocNum ?? null,
        sap_doc_date: doc.DocDate ? String(doc.DocDate).slice(0, 10) : null,
        sap_doc_status: cancelled ? "bost_Cancelled" : (doc.DocumentStatus || null),
        sap_cancelled: cancelled,
        sap_open_amount: cancelled ? 0 : open,
        sap_status_synced_at: new Date().toISOString(),
      };
      await supabase.from("advance_payments").update(update).eq("id", row.id);
      results.push({ id: row.id, ok: true, ...update });
    }

    return json({ success: true, synced: results.filter((r) => r.ok).length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ success: false, error: msg }, 500);
  } finally {
    if (cookies && baseUrl) {
      await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookies } }).catch(() => {});
    }
  }
});
