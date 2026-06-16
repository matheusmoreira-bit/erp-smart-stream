import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { requireAdmin, authErrorResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getSapBaseUrl(admin: ReturnType<typeof createClient>, companyDB: string): Promise<string> {
  const fallback = Deno.env.get("SAP_DEFAULT_BASE_URL") ||
    "https://jyl32uqm9176-sl.s1p-zona-01-4fd9831d6a58.saas.wevy.cloud/b1s/v2";
  const { data } = await admin
    .from("system_credentials")
    .select("credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap")
    .eq("credential_key", "service_layer_url")
    .maybeSingle();

  const raw = (typeof data?.credential_value === "string" && data.credential_value.trim())
    ? data.credential_value.trim()
    : fallback;
  let url = raw.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function getAdminCreds(admin: ReturnType<typeof createClient>, companyDB: string) {
  const { data } = await admin
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "sap")
    .eq("company_db", companyDB)
    .in("credential_key", ["username", "password"]);
  const map = new Map<string, string>();
  (data || []).forEach((r: { credential_key: string; credential_value: string | null }) => {
    if (r.credential_value) map.set(r.credential_key, r.credential_value);
  });
  const username = map.get("username");
  const password = map.get("password");
  if (!username || !password) return null;
  return { username, password };
}

interface SapSession {
  baseUrl: string;
  session: string;
  route: string;
}

async function sapLogin(baseUrl: string, companyDB: string, username: string, password: string): Promise<SapSession> {
  const resp = await fetch(`${baseUrl}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: companyDB, UserName: username, Password: password }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Falha login SAP: ${resp.status} ${text}`);
  }
  const cookies = resp.headers.get("set-cookie") || "";
  const sessionMatch = cookies.match(/B1SESSION=([^;]+)/);
  const routeMatch = cookies.match(/ROUTEID=([^;]+)/);
  const body = await resp.json().catch(() => ({} as { SessionId?: string }));
  const session = sessionMatch?.[1] || body.SessionId || "";
  if (!session) throw new Error("Sem session id na resposta do SAP");
  return { baseUrl, session, route: routeMatch?.[1] || "" };
}

async function sapLogout(s: SapSession) {
  try {
    await fetch(`${s.baseUrl}/Logout`, {
      method: "POST",
      headers: { Cookie: `B1SESSION=${s.session}${s.route ? `; ROUTEID=${s.route}` : ""}` },
    });
  } catch { /* noop */ }
}

async function sapRequest(s: SapSession, path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const resp = await fetch(`${s.baseUrl}/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `B1SESSION=${s.session}${s.route ? `; ROUTEID=${s.route}` : ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: resp.ok, status: resp.status, data };
}

function extractSapError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const err = (payload as { error?: { message?: unknown } }).error;
  if (!err) return fallback;
  const msg = err.message;
  if (typeof msg === "string") return msg;
  if (msg && typeof msg === "object" && typeof (msg as { value?: unknown }).value === "string") {
    return (msg as { value: string }).value;
  }
  return fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action as string | undefined;
    const companyDb = body.company_db as string | undefined;
    if (!action) {
      return new Response(JSON.stringify({ error: "action requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = getServiceClient();

    // List active SAP companies
    if (action === "list_companies") {
      const { data, error } = await admin
        .from("companies")
        .select("company_db, display_name")
        .eq("erp_type", "sap")
        .eq("is_active", true)
        .order("display_name");
      if (error) throw error;
      return new Response(JSON.stringify({ companies: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!companyDb) {
      return new Response(JSON.stringify({ error: "company_db requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const creds = await getAdminCreds(admin, companyDb);
    if (!creds) {
      return new Response(JSON.stringify({ error: "Sem credenciais administrativas configuradas para a empresa" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = await getSapBaseUrl(admin, companyDb);
    const session = await sapLogin(baseUrl, companyDb, creds.username, creds.password);

    try {
      if (action === "list_users") {
        const select = "InternalKey,UserCode,UserName,eMail,Locked,Superuser,Department,UserPermission";
        const all: Record<string, unknown>[] = [];
        let next: string | null = `Users?$select=${select}&$top=200`;
        while (next) {
          const result = await sapRequest(session, next, "GET");
          if (!result.ok) throw new Error(extractSapError(result.data, `Falha ao listar usuários (${result.status})`));
          const payload = result.data as { value?: Record<string, unknown>[]; "@odata.nextLink"?: string } | null;
          if (payload?.value) all.push(...payload.value);
          next = payload?.["@odata.nextLink"] ?? null;
          if (all.length > 5000) break;
        }
        return new Response(JSON.stringify({ users: all }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "update_user") {
        const internalKey = Number(body.internal_key);
        const patch = body.patch as Record<string, unknown> | undefined;
        if (!internalKey || !patch || typeof patch !== "object") {
          return new Response(JSON.stringify({ error: "internal_key e patch são obrigatórios" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const allowed = new Set(["UserName", "eMail", "Department", "UserPermission", "Locked", "UserPassword"]);
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
          if (allowed.has(k)) safe[k] = v;
        }
        if (Object.keys(safe).length === 0) {
          return new Response(JSON.stringify({ error: "Nenhum campo permitido no patch" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const result = await sapRequest(session, `Users(${internalKey})`, "PATCH", safe);
        if (!result.ok) throw new Error(extractSapError(result.data, `Falha ao atualizar usuário (${result.status})`));

        await admin.rpc("insert_audit_log", {
          p_action: "sap_user_update",
          p_entity_type: "sap_user",
          p_entity_id: String(internalKey),
          p_actor_email: caller.email,
          p_company_db: companyDb,
          p_details: { patch: Object.fromEntries(Object.entries(safe).filter(([k]) => k !== "UserPassword")) },
        });

        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Ação desconhecida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } finally {
      await sapLogout(session);
    }
  } catch (err) {
    const authResp = authErrorResponse(err, corsHeaders);
    if (authResp) return authResp;
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[sap-users-admin]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
