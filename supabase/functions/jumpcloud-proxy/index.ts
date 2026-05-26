import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdmin, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};


async function getJumpCloudCredentials(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "jumpcloud");

  if (error) throw new Error(`Erro ao buscar credenciais JumpCloud: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Credenciais JumpCloud não configuradas");

  const creds: Record<string, string> = {};
  for (const row of data) {
    creds[row.credential_key] = row.credential_value;
  }

  if (!creds.api_key) throw new Error("API Key do JumpCloud não configurada");
  return creds;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireAdmin(req);
    const supabase = createClient(

      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || (req.method === "POST" ? (await req.json()).action : null);

    const creds = await getJumpCloudCredentials(supabase);
    const apiKey = creds.api_key;
    const orgId = creds.org_id;

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (orgId) headers["x-org-id"] = orgId;

    // LIST USERS
    if (action === "listUsers" || (!action && req.method === "GET")) {
      const allUsers: unknown[] = [];
      let skip = 0;
      const limit = 100;
      let hasMore = true;

      while (hasMore) {
        const resp = await fetch(
          `https://console.jumpcloud.com/api/systemusers?limit=${limit}&skip=${skip}&fields=_id email username displayname firstname lastname suspended`,
          { headers }
        );

        if (!resp.ok) {
          const errText = await resp.text();
          console.error("JumpCloud API error:", resp.status, errText);
          throw new Error(`Erro na API JumpCloud: ${resp.status}`);
        }

        const data = await resp.json();
        const results = data.results || data || [];
        allUsers.push(...results);

        hasMore = results.length === limit;
        skip += limit;

        if (allUsers.length > 5000) hasMore = false;
      }

      return new Response(JSON.stringify({ users: allUsers }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SEARCH USERS
    if (action === "searchUsers") {
      const body = req.method === "POST" ? await req.json() : {};
      const query = body.query || url.searchParams.get("query") || "";

      const searchBody = {
        searchFilter: {
          or: [
            { email: { $regex: query } },
            { username: { $regex: query } },
            { firstname: { $regex: query } },
            { lastname: { $regex: query } },
          ],
        },
        fields: ["_id", "email", "username", "displayname", "firstname", "lastname", "suspended"],
        limit: 20,
      };

      const resp = await fetch("https://console.jumpcloud.com/api/search/systemusers", {
        method: "POST",
        headers,
        body: JSON.stringify(searchBody),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("JumpCloud search error:", resp.status, errText);
        throw new Error(`Erro na busca JumpCloud: ${resp.status}`);
      }

      const data = await resp.json();
      return new Response(JSON.stringify({ users: data.results || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida. Use: listUsers, searchUsers" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
