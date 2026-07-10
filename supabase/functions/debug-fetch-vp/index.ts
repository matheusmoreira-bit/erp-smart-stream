// Temp debug: fetch a VendorPayment from SAP with service credentials.
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
  const { companyDb, docEntry } = await req.json();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await sb.from("system_credentials").select("credential_key,credential_value").eq("system_name","sap").eq("company_db",companyDb);
  const kv: Record<string,string> = {};
  for (const r of (data||[]) as any[]) kv[r.credential_key] = r.credential_value ?? "";
  const baseUrl = buildBaseUrl(kv.service_layer_url);
  const lr = await fetch(`${baseUrl}/Login`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ UserName:kv.username, Password:kv.password, CompanyDB: kv.company_db || companyDb }) });
  if (!lr.ok) return new Response(JSON.stringify({error:"login",status:lr.status,body:await lr.text()}),{status:500,headers:{...corsHeaders,"Content-Type":"application/json"}});
  const sc = lr.headers.get("set-cookie") || "";
  const s = sc.match(/B1SESSION=([^;]+)/)?.[1];
  const rt = sc.match(/ROUTEID=([^;]+)/)?.[1];
  const cookie = `B1SESSION=${s}${rt?`; ROUTEID=${rt}`:""}`;
  const r = await fetch(`${baseUrl}/VendorPayments?$filter=DocNum eq ${docEntry}&$top=1`, { headers:{ Cookie: cookie } });
  const body = await r.text();
  return new Response(body, { status: r.status, headers: { ...corsHeaders, "Content-Type":"application/json" } });
});
