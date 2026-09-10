// Edge function: consulta no SAP B1 a situação real das NFs de entrada já
// lançadas (PurchaseInvoices) e sincroniza número, data e status no ERP Flow.
// POST /functions/v1/nf-entrada-erp-status
//   body: { import_id: string } | { company_db: string, limit?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUserOrSapSession } from "../_shared/auth.ts";
import { getIntegrationPause, pauseResponse } from "../_shared/integration-pause.ts";
import { corsFor, rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

function json(body: unknown, cors: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
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
  const cors = corsFor(req);
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  { const _pause = await getIntegrationPause("sap_b1"); if (_pause) return pauseResponse(_pause, cors); }

  try {
    await requireUserOrSapSession(req);
  } catch {
    return json({ success: false, error: "Faça login no SAP pela tela antes de sincronizar." }, cors, 401);
  }

  let cookies: string | null = null;
  let baseUrl = "";
  try {
    const body = await req.json().catch(() => ({}));
    const importId: string | undefined = typeof body.import_id === "string" ? body.import_id : undefined;
    const companyDbIn: string | undefined = typeof body.company_db === "string" ? body.company_db : undefined;
    const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 300);

    if (!importId && !companyDbIn) {
      return json({ success: false, error: "Informe import_id ou company_db." }, cors, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase
      .from("nf_entrada_imports")
      .select("id, sap_company_db, erp_invoice_doc_entry, valor_total")
      .not("erp_invoice_doc_entry", "is", null);
    if (importId) query = query.eq("id", importId);
    if (companyDbIn) query = query.eq("sap_company_db", companyDbIn);
    query = query.order("updated_at", { ascending: false }).limit(limit);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return json({ success: true, synced: 0, results: [] }, cors);

    const companyDb = String((rows as any[])[0].sap_company_db || companyDbIn || "");
    if (!companyDb) return json({ success: false, error: "Nota sem empresa definida no ERP." }, cors, 400);
    // Nunca misturar empresas numa mesma chamada.
    const filtered = (rows as any[]).filter((r) => r.sap_company_db === companyDb);

    const headerCompany = req.headers.get("x-company-db");
    if (headerCompany && headerCompany !== companyDb) {
      return json({ success: false, error: "Empresa da sessão não corresponde à nota." }, cors, 403);
    }

    const creds = await getSapCreds(supabase, companyDb);
    baseUrl = getSapBaseUrl(creds);
    cookies = await sapLogin(baseUrl, creds, companyDb);

    const results: Record<string, unknown>[] = [];
    for (const row of filtered) {
      const docEntry = Number(row.erp_invoice_doc_entry);
      if (!Number.isFinite(docEntry)) {
        results.push({ id: row.id, ok: false, error: "Documento do ERP inválido" });
        continue;
      }
      const url = `${baseUrl}/PurchaseInvoices(${docEntry})?$select=DocEntry,DocNum,DocDate,DocumentStatus,Cancelled,DocTotal,PaidToDate`;
      const res = await fetch(url, { headers: { Cookie: cookies } });
      const doc = await res.json().catch(() => ({}));
      if (!res.ok) {
        results.push({ id: row.id, ok: false, error: doc?.error?.message?.value || `HTTP ${res.status}` });
        continue;
      }
      const cancelled = doc.Cancelled === "tYES";
      const docTotal = Number(doc.DocTotal ?? row.valor_total ?? 0);
      const paid = Number(doc.PaidToDate ?? 0);
      const open = Math.max(docTotal - paid, 0);
      const update: Record<string, unknown> = {
        erp_invoice_doc_num: doc.DocNum != null ? String(doc.DocNum) : null,
        erp_invoice_doc_date: doc.DocDate ? String(doc.DocDate).slice(0, 10) : null,
        erp_invoice_doc_status: cancelled ? "bost_Cancelled" : (doc.DocumentStatus || null),
        erp_invoice_cancelled: cancelled,
        erp_invoice_open_amount: cancelled ? 0 : open,
        erp_invoice_status_synced_at: new Date().toISOString(),
      };
      await supabase.from("nf_entrada_imports").update(update).eq("id", row.id);
      results.push({ id: row.id, ok: true, ...update });
    }

    return json({ success: true, synced: results.filter((r) => r.ok).length, results }, cors);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ success: false, error: msg }, cors, 500);
  } finally {
    if (cookies && baseUrl) {
      await fetch(`${baseUrl}/Logout`, { method: "POST", headers: { Cookie: cookies } }).catch(() => {});
    }
  }
});
