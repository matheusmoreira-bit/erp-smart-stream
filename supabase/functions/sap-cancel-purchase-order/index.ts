// Cancel one or more Purchase Orders directly in SAP B1 via Service Layer.
// POST { companyDb: string, docEntries: number[], reason?: string }
// Uses system_credentials for the company.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function getCreds(sb: ReturnType<typeof createClient>, companyDb: string) {
  const { data, error } = await sb
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDb);
  if (error) throw new Error(`Credenciais: ${error.message}`);
  if (!data?.length) throw new Error(`Sem credenciais SAP para ${companyDb}`);
  const out: Record<string, string> = {};
  for (const r of data as any[]) out[r.credential_key] = r.credential_value;
  return out;
}

async function login(creds: Record<string, string>) {
  let baseUrl = (creds.service_layer_url || creds.base_url || creds.url || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("URL do SAP B1 não configurada");
  if (baseUrl.includes("/b1s/v1")) baseUrl = baseUrl.replace("/b1s/v1", "/b1s/v2");
  else if (!baseUrl.includes("/b1s/v2")) baseUrl = `${baseUrl}/b1s/v2`;
  const r = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: creds.company_db || creds.CompanyDB,
      UserName: creds.username || creds.UserName,
      Password: creds.password || creds.Password,
    }),
  });
  if (!r.ok) throw new Error(`SAP Login falhou (${r.status}): ${await r.text()}`);
  return { baseUrl, cookies: r.headers.get("set-cookie") || "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { companyDb, docEntries, reason } = await req.json();
    if (!companyDb) throw new Error("companyDb obrigatório");
    if (!Array.isArray(docEntries) || docEntries.length === 0)
      throw new Error("docEntries[] obrigatório");

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const creds = await getCreds(sb, companyDb);
    const sap = await login(creds);

    const results: any[] = [];
    for (const de of docEntries) {
      // Guard anti duplo-clique: tenta marcar o lock no expense correspondente.
      // Se 0 rows atualizadas → já foi cancelado ou outro processo está cancelando.
      const cutoffIso = new Date(Date.now() - 2 * 60_000).toISOString();
      const { data: lockedRows } = await sb
        .from("expenses")
        .update({ sap_integration_locked_at: new Date().toISOString() })
        .eq("company_db", companyDb)
        .eq("sap_doc_entry", Number(de))
        .or(`sap_integration_locked_at.is.null,sap_integration_locked_at.lt.${cutoffIso}`)
        .select("id, requester_email");

      if (!lockedRows || lockedRows.length === 0) {
        results.push({ docEntry: de, status: 0, ok: false, body: "skipped: já cancelado ou em curso" });
        continue;
      }

      const url = `${sap.baseUrl}/PurchaseOrders(${Number(de)})/Cancel`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sap.cookies },
      });
      const body = await r.text().catch(() => "");
      const ok = r.status === 204 || r.ok;
      results.push({ docEntry: de, status: r.status, ok, body: body.slice(0, 300) });

      const exp = lockedRows[0] as any;
      if (ok) {
        await sb
          .from("expenses")
          .update({
            status: "pendente_aprovacao",
            sap_doc_entry: null,
            sap_doc_num: null,
            sap_purchase_order_status: null,
            sap_integration_error: `Cancelado no SAP em ${new Date().toISOString()} — ${reason || "bypass de aprovação"}`,
            sap_integration_locked_at: null,
          } as any)
          .eq("id", exp.id);
        await sb.rpc("insert_audit_log", {
          p_action: "sap_purchase_order_cancelled",
          p_entity_type: "expense",
          p_entity_id: exp.id,
          p_company_db: companyDb,
          p_details: { docEntry: de, reason: reason || null } as any,
        });
      } else {
        // Libera o lock para permitir nova tentativa imediata
        await sb.from("expenses").update({ sap_integration_locked_at: null }).eq("id", exp.id);
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
