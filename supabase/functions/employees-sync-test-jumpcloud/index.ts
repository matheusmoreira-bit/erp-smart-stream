// Testa a API do JumpCloud usando as credenciais gravadas em system_credentials
// para a company_db informada. Retorna contagem de usuários.
import { CORS_HEADERS, jsonResponse, admin, loadCredentials, fetchAllJumpCloudUsers, assertTstCompany } from "../_shared/employee-sync.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body.company_db || "");
    assertTstCompany(companyDb);
    const supabase = admin();
    const creds = await loadCredentials(supabase, "jumpcloud", companyDb);
    if (!creds.api_key) throw new Error("JumpCloud API Key não configurada para a base.");
    const users = await fetchAllJumpCloudUsers(creds.api_key, creds.org_id);
    const suspended = users.filter((u) => u.suspended === true).length;
    return jsonResponse({
      ok: true,
      total: users.length,
      suspended,
      active: users.length - suspended,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error).message }, 400);
  }
});
