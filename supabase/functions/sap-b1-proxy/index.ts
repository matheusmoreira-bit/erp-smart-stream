import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sap-session, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_SAP_BASE_URL = "https://jyl32uqm9176-sl.s1p-zona-01-4fd9831d6a58.saas.wevy.cloud/b1s/v1";
const HANA_VIEWS_URL = "https://anagaming.app.n8n.cloud/webhook/d7c643d9-040c-4e60-aa26-99344e60e89b";

// In-memory cache with TTL
const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractViewRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    const wrapped = payload.find((item) => {
      return !!item && typeof item === "object" && Array.isArray((item as { data?: unknown[] }).data);
    }) as { data?: unknown[] } | undefined;

    if (wrapped?.data) {
      return wrapped.data;
    }

    return payload;
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)) {
    return (payload as { data: unknown[] }).data;
  }

  return [];
}

function extractTableName(table: string): string {
  const trimmed = table.trim();
  return trimmed.includes(".") ? trimmed.split(".").pop() || trimmed : trimmed;
}

async function getSapBaseUrl(companyDB?: string): Promise<string> {
  if (!companyDB) return DEFAULT_SAP_BASE_URL;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceRoleKey);
    const { data } = await sb
      .from("companies")
      .select("service_layer_url")
      .eq("company_db", companyDB)
      .maybeSingle();
    if (data?.service_layer_url) {
      let url = data.service_layer_url.replace(/\/+$/, "");
      // Ensure the URL includes the /b1s/v1 path
      if (!url.includes("/b1s/v1")) {
        url = `${url}/b1s/v1`;
      }
      return url;
    }
  } catch (e) {
    console.error("Failed to fetch service_layer_url:", e);
  }
  return DEFAULT_SAP_BASE_URL;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const reqBody = await req.json();
    const { action, credentials, endpoint, params, sessionId, routeId, table, database, companyDB } = reqBody;

    // Resolve the SAP Service Layer base URL dynamically per company
    const SAP_BASE_URL = await getSapBaseUrl(companyDB || credentials?.CompanyDB);

    // LOGIN
    if (action === "login") {
      if (!credentials?.UserName || !credentials?.Password || !credentials?.CompanyDB) {
        return new Response(JSON.stringify({ error: "UserName, Password e CompanyDB são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const loginResp = await fetch(`${SAP_BASE_URL}/Login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          UserName: credentials.UserName,
          Password: credentials.Password,
          CompanyDB: credentials.CompanyDB,
        }),
      });

      if (!loginResp.ok) {
        const errorText = await loginResp.text();
        console.error("SAP Login error:", loginResp.status, errorText);
        let errorMsg = "Falha no login SAP B1";
        try {
          const parsed = JSON.parse(errorText);
          errorMsg = parsed?.error?.message?.value || errorMsg;
        } catch { /* ignore */ }
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: loginResp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const loginData = await loginResp.json();
      // Extract session cookie
      const setCookie = loginResp.headers.get("set-cookie") || "";
      const sessionMatch = setCookie.match(/B1SESSION=([^;]+)/);
      const routeMatch = setCookie.match(/ROUTEID=([^;]+)/);

      return new Response(JSON.stringify({
        sessionId: sessionMatch?.[1] || loginData.SessionId,
        routeId: routeMatch?.[1] || "",
        sessionTimeout: loginData.SessionTimeout,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // QUERY - proxy SAP B1 requests with pagination and caching
    if (action === "query") {
      if (!sessionId || !endpoint) {
        return new Response(JSON.stringify({ error: "sessionId e endpoint são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Build query string
      const queryParams = new URLSearchParams();
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            queryParams.set(key, String(value));
          }
        }
      }

      const queryString = queryParams.toString();
      const fullUrl = `${SAP_BASE_URL}/${endpoint}${queryString ? `?${queryString}` : ""}`;

      // Check cache
      const cacheKey = `${sessionId}:${fullUrl}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ data: cached, fromCache: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cookies = `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
      const sapResp = await fetch(fullUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookies,
        },
      });

      if (!sapResp.ok) {
        const errorText = await sapResp.text();
        console.error("SAP query error:", sapResp.status, errorText);
        let errorMsg = "Erro na consulta SAP B1";
        try {
          const parsed = JSON.parse(errorText);
          errorMsg = parsed?.error?.message?.value || errorMsg;
        } catch { /* ignore */ }
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: sapResp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await sapResp.json();
      setCache(cacheKey, data);

      return new Response(JSON.stringify({ data, fromCache: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // QUERY ALL - fetch all pages automatically
    if (action === "queryAll") {
      if (!sessionId || !endpoint) {
        return new Response(JSON.stringify({ error: "sessionId e endpoint são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cacheKey = `${sessionId}:all:${endpoint}:${JSON.stringify(params || {})}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ data: cached, fromCache: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cookies = `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
      const allResults: unknown[] = [];
      let skip = 0;
      const top = 20;
      let hasMore = true;

      while (hasMore) {
        const queryParams = new URLSearchParams();
        if (params) {
          for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && key !== "$skip" && key !== "$top") {
              queryParams.set(key, String(value));
            }
          }
        }
        queryParams.set("$top", String(top));
        queryParams.set("$skip", String(skip));

        const fullUrl = `${SAP_BASE_URL}/${endpoint}?${queryParams.toString()}`;
        const sapResp = await fetch(fullUrl, {
          method: "GET",
          headers: { "Content-Type": "application/json", Cookie: cookies },
        });

        if (!sapResp.ok) {
          const errorText = await sapResp.text();
          console.error("SAP queryAll error:", sapResp.status, errorText);
          break;
        }

        const pageData = await sapResp.json();
        const items = pageData.value || [];
        allResults.push(...items);

        hasMore = !!pageData["odata.nextLink"] || items.length === top;
        skip += top;

        // Safety limit
        if (allResults.length > 5000) {
          hasMore = false;
        }
      }

      const result = { value: allResults, totalCount: allResults.length };
      setCache(cacheKey, result);

      return new Response(JSON.stringify({ data: result, fromCache: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // QUERY VIEW - fetch processed HANA views through external API
    if (action === "queryView") {
      if (!sessionId || !database || !table) {
        return new Response(JSON.stringify({ error: "sessionId, database e table são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tableName = extractTableName(table);
      const cacheKey = `${sessionId}:view:${database}:${tableName}:${JSON.stringify(params || {})}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ data: cached, fromCache: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const queryParams = new URLSearchParams({
        SessionId: sessionId,
        DB: database,
        Table: tableName,
        _t: String(Date.now()),
      });

      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null && key !== "SessionId" && key !== "DB" && key !== "Table") {
            queryParams.set(key, String(value));
          }
        }
      }

      const viewResp = await fetch(`${HANA_VIEWS_URL}?${queryParams.toString()}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const payload = await parseResponseBody(viewResp);

      if (!viewResp.ok) {
        const message =
          payload && typeof payload === "object" && "message" in payload
            ? String((payload as { message?: string }).message || "Erro na consulta da view HANA")
            : typeof payload === "string"
              ? payload
              : "Erro na consulta da view HANA";
        console.error("HANA view query error:", viewResp.status, payload);
        return new Response(JSON.stringify({ error: message }), {
          status: viewResp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rows = extractViewRows(payload);
      if (rows.length > 0) {
        setCache(cacheKey, rows);
      }

      return new Response(JSON.stringify({ data: rows, fromCache: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // LOGOUT
    if (action === "logout") {
      if (sessionId) {
        const cookies = `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
        await fetch(`${SAP_BASE_URL}/Logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookies },
        }).catch(() => {});
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SAP ACTION - POST/PATCH to SAP Service Layer
    if (action === "sapAction") {
      if (!sessionId || !endpoint) {
        return new Response(JSON.stringify({ error: "sessionId e endpoint são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const httpMethod = reqBody.method || "POST";
      const actionBody = reqBody.body || undefined;
      const cookies = `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
      const fullUrl = `${SAP_BASE_URL}/${endpoint}`;

      const sapResp = await fetch(fullUrl, {
        method: httpMethod,
        headers: { "Content-Type": "application/json", Cookie: cookies },
        body: actionBody ? JSON.stringify(actionBody) : undefined,
      });

      const respText = await sapResp.text();
      let respData: unknown;
      try { respData = JSON.parse(respText); } catch { respData = respText; }

      if (!sapResp.ok) {
        let errorMsg = "Erro na ação SAP B1";
        if (respData && typeof respData === "object" && "error" in respData) {
          errorMsg = (respData as any).error?.message?.value || errorMsg;
        }
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: sapResp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ data: respData }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida. Use: login, query, queryAll, queryView, sapAction, logout" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sap-b1-proxy error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
