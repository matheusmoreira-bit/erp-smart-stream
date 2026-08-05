// Edge function: sap-nfse-probe (diagnóstico)
// Retorna os campos de usuário (U_*) de faturas de venda no SAP, para
// identificar qual UDF o addon fiscal usa para transmitir a NFS-e.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function buildBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body?.company_db || "");
    const docEntries: number[] = Array.isArray(body?.doc_entries)
      ? body.doc_entries.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
      : [];
    if (!companyDb || docEntries.length === 0) {
      return new Response(JSON.stringify({ error: "company_db e doc_entries obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await sb
      .from("system_credentials")
      .select("credential_key, credential_value")
      .eq("system_name", "sap")
      .eq("company_db", companyDb);
    const kv: Record<string, string> = {};
    for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
      kv[r.credential_key] = r.credential_value ?? "";
    }
    const baseUrl = buildBaseUrl(kv.service_layer_url || "");
    const login = await fetch(`${baseUrl}/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ UserName: kv.username, Password: kv.password, CompanyDB: kv.company_db || companyDb }),
    });
    if (!login.ok) throw new Error(`login ${login.status}`);
    const cookies = login.headers.get("set-cookie") || "";
    const out: Record<string, unknown> = {};
    for (const de of docEntries) {
      const r = await fetch(`${baseUrl}/Invoices(${de})`, { headers: { Cookie: cookies } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { out[String(de)] = { error: j?.error?.message?.value || r.status }; continue; }
      const udfs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(j)) {
        if (k.startsWith("U_") && v !== null && v !== "") udfs[k] = v;
      }
      out[String(de)] = {
        DocNum: j.DocNum, DocumentStatus: j.DocumentStatus, Cancelled: j.Cancelled,
        SequenceSerial: j.SequenceSerial, udfs,
      };
    }
    return new Response(JSON.stringify({ result: out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
