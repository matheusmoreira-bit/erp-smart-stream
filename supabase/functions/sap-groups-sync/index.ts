// Sincroniza grupos do SAP B1 (UserGroups) em public.sap_groups_cache
// Uso: POST { company_db: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireAdmin, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function service() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getSapBaseUrl(
  admin: ReturnType<typeof createClient>,
  companyDB: string,
): Promise<string> {
  const fallback =
    Deno.env.get("SAP_DEFAULT_BASE_URL") ||
    "https://jyl32uqm9176-sl.s1p-zona-01-4fd9831d6a58.saas.wevy.cloud/b1s/v2";
  const { data } = await admin
    .from("system_credentials")
    .select("credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap")
    .eq("credential_key", "service_layer_url")
    .maybeSingle();
  const raw =
    typeof data?.credential_value === "string" && data.credential_value.trim()
      ? data.credential_value.trim()
      : fallback;
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function getAdminCreds(
  admin: ReturnType<typeof createClient>,
  companyDB: string,
) {
  const { data } = await admin
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDB)
    .in("credential_key", ["username", "password", "company_db"]);
  const map = new Map<string, string>();
  (data || []).forEach((r: any) => {
    if (r.credential_value) map.set(r.credential_key, r.credential_value);
  });
  const username = map.get("username");
  const password = map.get("password");
  const credCompanyDb = map.get("company_db");
  const sapCompanyDb =
    credCompanyDb && !/^https?:\/\//i.test(credCompanyDb)
      ? credCompanyDb
      : companyDB;
  if (!username || !password) return null;
  return { username, password, sapCompanyDb };
}

async function sapLogin(
  baseUrl: string,
  companyDB: string,
  username: string,
  password: string,
) {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      CompanyDB: companyDB,
      UserName: username,
      Password: password,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Falha login SAP: ${resp.status} ${text}`);
  }
  const cookies = resp.headers.get("set-cookie") || "";
  const session = cookies.match(/B1SESSION=([^;]+)/)?.[1] ?? "";
  const route = cookies.match(/ROUTEID=([^;]+)/)?.[1] ?? "";
  if (!session) throw new Error("Sem session id");
  return { baseUrl, session, route };
}

async function sapLogout(s: {
  baseUrl: string;
  session: string;
  route: string;
}) {
  try {
    await fetch(`${s.baseUrl}/Logout`, {
      method: "POST",
      headers: {
        Cookie: `B1SESSION=${s.session}${s.route ? `; ROUTEID=${s.route}` : ""}`,
      },
    });
  } catch {
    /* noop */
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const companyDB = String(body.company_db || "").trim();
    if (!companyDB) {
      return new Response(
        JSON.stringify({ error: "company_db obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const admin = service();
    const creds = await getAdminCreds(admin, companyDB);
    if (!creds) {
      return new Response(
        JSON.stringify({ error: "Credenciais SAP não configuradas para esta empresa" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const baseUrl = await getSapBaseUrl(admin, companyDB);
    const session = await sapLogin(
      baseUrl,
      creds.sapCompanyDb,
      creds.username,
      creds.password,
    );
    try {
      // SAP B1 UserGroups (Service Layer): resource "UserGroups"
      // Alguns tenants não expõem esse endpoint por padrão — se falhar, retornamos 0 sem erro
      const resp = await fetch(
        `${baseUrl}/UserGroups?$select=Code,Name&$top=200`,
        {
          headers: {
            Cookie: `B1SESSION=${session.session}${session.route ? `; ROUTEID=${session.route}` : ""}`,
          },
        },
      );
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return new Response(
          JSON.stringify({
            error: `SAP retornou ${resp.status}: ${text.slice(0, 300)}`,
            count: 0,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const json = (await resp.json()) as { value?: Array<{ Code: number | string; Name: string }> };
      const rows = (json.value || []).map((g) => ({
        company_db: companyDB,
        group_code: String(g.Code),
        group_name: g.Name,
        source: "service_layer",
        synced_at: new Date().toISOString(),
      }));
      if (rows.length > 0) {
        // apaga anteriores desta empresa antes de reinserir para refletir remoções
        await admin.from("sap_groups_cache").delete().eq("company_db", companyDB);
        await admin.from("sap_groups_cache").upsert(rows, {
          onConflict: "company_db,group_code",
        });
      }
      return new Response(
        JSON.stringify({ ok: true, count: rows.length }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } finally {
      await sapLogout(session);
    }
  } catch (e) {
    if ((e as any)?.status && (e as any)?.message) {
      return authErrorResponse(e as any, corsHeaders);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
