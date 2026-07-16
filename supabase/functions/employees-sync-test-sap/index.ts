// Testa conexão SAP e presença dos UDFs necessários no cadastro EmployeesInfo.
import {
  CORS_HEADERS, jsonResponse, admin, loadCredentials, sapLogin, sapCheckUdfs, assertTstCompany, REQUIRED_UDFS,
} from "../_shared/employee-sync.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body.company_db || "");
    assertTstCompany(companyDb);
    const supabase = admin();
    const sapCreds = await loadCredentials(supabase, "sap", companyDb);
    const session = await sapLogin(sapCreds);
    const { present, missing } = await sapCheckUdfs(session);
    return jsonResponse({
      ok: missing.length === 0,
      required: REQUIRED_UDFS,
      present,
      missing,
      companyDb: session.companyDB,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error).message }, 400);
  }
});
