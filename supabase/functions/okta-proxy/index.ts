import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { authErrorResponse, requireAdminOrSapModule } from "../_shared/auth.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";
import { listOktaUsers, normalizeOktaOrgUrl, type OktaCredentials } from "../_shared/okta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function getCredentials(supabase: ReturnType<typeof createClient>): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value, updated_at")
    .eq("system_name", "okta")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Erro ao buscar credenciais Okta: ${error.message}`);
  const credentials: Record<string, string> = {};
  for (const row of data || []) {
    if (!(row.credential_key in credentials)) credentials[row.credential_key] = row.credential_value;
  }
  return credentials;
}

function buildCredentials(saved: Record<string, string>, body: Record<string, unknown>): OktaCredentials {
  return {
    org_url: String(body.org_url || saved.org_url || ""),
    client_id: String(body.client_id || saved.client_id || ""),
    private_key: String(body.private_key || saved.private_key || ""),
    key_id: String(body.key_id || saved.key_id || ""),
  };
}

Deno.serve(async (req) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    await requireAdminOrSapModule(req, "users");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = url.searchParams.get("action") || body.action || (req.method === "GET" ? "listUsers" : null);
    const credentials = buildCredentials(await getCredentials(supabase), body);

    if (action === "testConnection") {
      const startedAt = Date.now();
      try {
        const users = await listOktaUsers(credentials, 1);
        return new Response(JSON.stringify({
          ok: true,
          org_url: normalizeOktaOrgUrl(credentials.org_url),
          visible_users: users.length,
          elapsedMs: Date.now() - startedAt,
          message: "Service App autenticado e API de usuarios acessivel.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - startedAt,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (action === "listUsers") {
      const users = await listOktaUsers(credentials);
      return new Response(JSON.stringify({ users }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Acao invalida. Use: testConnection ou listUsers" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const authResponse = authErrorResponse(error, corsHeaders);
    if (authResponse) return authResponse;
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
