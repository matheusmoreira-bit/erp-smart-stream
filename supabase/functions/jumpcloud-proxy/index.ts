import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrSapModule, authErrorResponse } from "../_shared/auth.ts";
import { rejectForeignOrigin } from "../_shared/cors-allowlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};


async function getJumpCloudCredentials(supabase: ReturnType<typeof createClient>) {
  // JumpCloud é uma integração tenant-wide (não por empresa). Historicamente,
  // o painel de credenciais permitia salvar por company_db, o que gerou
  // múltiplos conjuntos (global + por empresa). Aqui pegamos SEMPRE o valor
  // mais recente de cada chave, independente do company_db, para que a
  // última atualização feita pelo admin prevaleça.
  const { data, error } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value, updated_at, company_db")
    .eq("system_name", "jumpcloud")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Erro ao buscar credenciais JumpCloud: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Credenciais JumpCloud não configuradas");

  const creds: Record<string, string> = {};
  for (const row of data as any[]) {
    // Primeiro que aparecer (mais recente) vence — não sobrescreva.
    if (!(row.credential_key in creds)) {
      creds[row.credential_key] = row.credential_value;
    }
  }

  if (!creds.api_key) throw new Error("API Key do JumpCloud não configurada");
  return creds;
}

Deno.serve(async (req) => {
  const foreignOrigin = rejectForeignOrigin(req);
  if (foreignOrigin) return foreignOrigin;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    await requireAdminOrSapModule(req, "users");
    const supabase = createClient(

      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    let body: Record<string, any> = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }
    const action = url.searchParams.get("action") || body.action || null;

    const creds = await getJumpCloudCredentials(supabase).catch((e) => {
      // Para testKey, permitimos operar sem credenciais salvas se overrides forem enviados
      if (action === "testKey" && (body.api_key || body.apiKey)) return {} as Record<string, string>;
      throw e;
    });

    // Overrides (só para testKey/preflight — não persistem)
    const overrideApiKey = (body.api_key || body.apiKey || "").toString().trim();
    const overrideIsMtpRaw = body.is_mtp ?? body.isMtp;
    const apiKey = overrideApiKey || creds.api_key;
    const isMtp = overrideIsMtpRaw !== undefined
      ? String(overrideIsMtpRaw).toLowerCase() === "true"
      : String(creds.is_mtp ?? "").toLowerCase() === "true";
    // org_id armazenado é IGNORADO — MTP descobre via /api/organizations; stand-alone dispensa header.
    const legacyOrgId = (creds.org_id || "").trim();

    const apiKeyTrim = (apiKey || "").trim();
    if (!apiKeyTrim) {
      return new Response(JSON.stringify({ ok: false, error: "API Key não informada." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseHeaders: Record<string, string> = {
      "x-api-key": apiKeyTrim,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const withOrg = (orgId?: string) => {
      const h = { ...baseHeaders };
      if (orgId) h["x-org-id"] = orgId;
      return h;
    };

    const parseJumpCloudError = (status: number, errText: string, ctx?: string): string => {
      let detail = errText;
      try {
        const parsed = JSON.parse(errText);
        detail = parsed.message || parsed.error || errText;
      } catch { /* keep raw */ }
      if (status === 401) return `JumpCloud: API Key inválida ou sem permissão (${detail}).`;
      if (status === 403) return `JumpCloud: API Key sem permissão para ${ctx ?? "esta operação"} (${detail}).`;
      if (status === 404 && /organization/i.test(detail)) {
        return `JumpCloud: organização não encontrada${ctx ? ` em ${ctx}` : ""}. Verifique se a API Key é MTP (marque a opção "Conta MTP") ou stand-alone.`;
      }
      return `Erro na API JumpCloud (${status}${ctx ? ` @ ${ctx}` : ""}): ${detail}`;
    };

    // Descobre organizations (MTP) ou usa uma "org virtual" para stand-alone.
    type Org = { id: string; name: string };
    const listOrganizations = async (): Promise<Org[]> => {
      const resp = await fetch("https://console.jumpcloud.com/api/organizations?limit=100", {
        headers: baseHeaders,
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error("JumpCloud /organizations error:", resp.status, errText);
        throw new Error(parseJumpCloudError(resp.status, errText, "/organizations"));
      }
      const data = await resp.json();
      const results = data.results || data.organizations || data || [];
      return (results as any[]).map((o) => ({
        id: o._id || o.id,
        name: o.displayName || o.name || o._id || o.id,
      })).filter((o) => !!o.id);
    };

    // Ação: testar chave (opcionalmente com overrides api_key/is_mtp vindos do formulário).
    if (action === "testKey") {
      const started = Date.now();
      try {
        if (isMtp) {
          // MTP → precisa listar organizations com essa key
          const orgs = await listOrganizations();
          return new Response(JSON.stringify({
            ok: true,
            mode: "mtp",
            organizations_count: orgs.length,
            organizations: orgs.slice(0, 20),
            elapsedMs: Date.now() - started,
            message: `Chave MTP válida — ${orgs.length} organization(s) acessíveis.`,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else {
          // Stand-alone → chama /api/systemusers?limit=1
          const resp = await fetch(
            "https://console.jumpcloud.com/api/systemusers?limit=1&fields=_id email",
            { headers: baseHeaders }
          );
          if (!resp.ok) {
            const errText = await resp.text();
            return new Response(JSON.stringify({
              ok: false,
              status: resp.status,
              error: parseJumpCloudError(resp.status, errText, "/systemusers"),
              elapsedMs: Date.now() - started,
            }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          const data = await resp.json();
          const total = data.totalCount ?? (data.results?.length ?? 0);
          return new Response(JSON.stringify({
            ok: true,
            mode: "standalone",
            total_users: total,
            elapsedMs: Date.now() - started,
            message: `Chave stand-alone válida — ${total} usuário(s) visível(is).`,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(JSON.stringify({
          ok: false,
          error: msg,
          elapsedMs: Date.now() - started,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Ação explícita: listar organizations (para UI de diagnóstico).
    if (action === "listOrganizations") {
      if (!isMtp) {
        return new Response(JSON.stringify({
          organizations: [],
          is_mtp: false,
          message: "Conta configurada como stand-alone; /organizations só se aplica a contas MTP.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const orgs = await listOrganizations();
      return new Response(JSON.stringify({ organizations: orgs, is_mtp: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Alvos: MTP → todas orgs; stand-alone → uma passagem sem x-org-id (mantém legacyOrgId se ainda existir para compat).
    const targets: Array<Org | null> = isMtp
      ? (await listOrganizations())
      : [legacyOrgId ? { id: legacyOrgId, name: "default" } : null];

    if (isMtp && targets.length === 0) {
      throw new Error("JumpCloud MTP: nenhuma organization retornada por /api/organizations. Verifique se a API Key é do tenant MTP.");
    }

    const fetchUsersForOrg = async (org: Org | null) => {
      const headers = withOrg(org?.id);
      const collected: any[] = [];
      let skip = 0;
      const limit = 100;
      let hasMore = true;
      while (hasMore) {
        const resp = await fetch(
          `https://console.jumpcloud.com/api/systemusers?limit=${limit}&skip=${skip}&fields=_id email username displayname firstname lastname suspended department costCenter jobTitle company employeeIdentifier employeeType manager`,
          { headers }
        );
        if (!resp.ok) {
          const errText = await resp.text();
          console.error("JumpCloud API error:", resp.status, errText, "org:", org?.id);
          throw new Error(parseJumpCloudError(resp.status, errText, org ? `org ${org.name} (${org.id})` : "stand-alone"));
        }
        const data = await resp.json();
        const results = data.results || data || [];
        for (const u of results as any[]) {
          collected.push(org ? { ...u, __org_id: org.id, __org_name: org.name } : u);
        }
        hasMore = results.length === limit;
        skip += limit;
        if (collected.length > 20000) hasMore = false;
      }
      return collected;
    };

    // LIST USERS
    if (action === "listUsers" || (!action && req.method === "GET")) {
      const allUsers: unknown[] = [];
      for (const org of targets) {
        const users = await fetchUsersForOrg(org);
        allUsers.push(...users);
      }
      return new Response(JSON.stringify({
        users: allUsers,
        is_mtp: isMtp,
        organizations: isMtp ? (targets as Org[]).map((o) => ({ id: o!.id, name: o!.name })) : [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SEARCH USERS (busca em todas orgs quando MTP)
    if (action === "searchUsers") {
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
        fields: ["_id", "email", "username", "displayname", "firstname", "lastname", "suspended", "department", "costCenter", "jobTitle", "company", "employeeIdentifier", "employeeType", "manager"],
        limit: 20,
      };

      const allResults: any[] = [];
      for (const org of targets) {
        const resp = await fetch("https://console.jumpcloud.com/api/search/systemusers", {
          method: "POST",
          headers: withOrg(org?.id),
          body: JSON.stringify(searchBody),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          console.error("JumpCloud search error:", resp.status, errText, "org:", org?.id);
          throw new Error(parseJumpCloudError(resp.status, errText, org ? `org ${org.name} (${org.id})` : "stand-alone"));
        }
        const data = await resp.json();
        for (const u of (data.results || []) as any[]) {
          allResults.push(org ? { ...u, __org_id: org.id, __org_name: org.name } : u);
        }
      }

      return new Response(JSON.stringify({ users: allResults }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida. Use: listUsers, searchUsers, listOrganizations" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const authResp = authErrorResponse(error, corsHeaders);
    if (authResp) return authResp;
    const message = error instanceof Error ? error.message : "Erro desconhecido";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
