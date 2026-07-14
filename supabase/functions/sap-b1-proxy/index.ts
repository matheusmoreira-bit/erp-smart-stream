import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { generateDynamicToken } from "../_shared/sap-middleware-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sap-session, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Use env vars instead of hardcoded URLs
const DEFAULT_SAP_BASE_URL = Deno.env.get("SAP_DEFAULT_BASE_URL") || "https://jyl32uqm9176-sl.s1p-zona-01-4fd9831d6a58.saas.wevy.cloud/b1s/v2";
const HANA_VIEWS_URL = Deno.env.get("HANA_VIEWS_URL") || "https://anagaming.app.n8n.cloud/webhook/d7c643d9-040c-4e60-aa26-99344e60e89b";
const APPROVALS_CACHE_KEY = "approvals:detailed";
const encoder = new TextEncoder();

// In-memory cache with TTL
const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

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

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function signSapAuthToken(params: { companyDB: string; userName: string; sessionId: string; expiresAt: number }) {
  const secret = Deno.env.get("SAP_MIDDLEWARE_SECRET") || "";
  if (!secret) return null;
  const payload = {
    companyDB: params.companyDB,
    userName: params.userName,
    sidHash: await sha256Base64Url(params.sessionId),
    exp: Math.floor(params.expiresAt / 1000),
  };
  const payloadPart = base64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payloadPart)));
  return `${payloadPart}.${base64Url(signature)}`;
}

async function requireAuth(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("UNAUTHORIZED");
  return user;
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
    if (wrapped?.data) return wrapped.data;
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

function validateEndpoint(endpoint: string): boolean {
  if (!endpoint || typeof endpoint !== "string" || endpoint.length > 4000) return false;
  if (endpoint.includes("..") || endpoint.startsWith("http")) return false;
  return true;
}

function extractSapErrorMessage(payload: unknown, fallback: string): string {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload || fallback;
  if (typeof payload !== "object") return fallback;

  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (message && typeof message === "object") {
      const value = (message as { value?: unknown }).value;
      if (typeof value === "string" && value.trim()) return value;
    }
  }

  return fallback;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 25_000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "AbortError" ||
    error.message.toLowerCase().includes("aborted") ||
    error.message.toLowerCase().includes("signal")
  );
}

async function getSapBaseUrl(companyDB?: string): Promise<string> {
  if (!companyDB) return DEFAULT_SAP_BASE_URL;
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1) Primary source: ERP credential configured in Backoffice (system_credentials)
    const { data: credRow } = await sb
      .from("system_credentials")
      .select("credential_value")
      .eq("company_db", companyDB)
      .eq("system_name", "sap")
      .eq("credential_key", "service_layer_url")
      .maybeSingle();
    if (credRow?.credential_value) {
      let url = String(credRow.credential_value).replace(/\/+$/, "");
      if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
      else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
      return url;
    }

    // 2) Fallback: legacy column on companies table
    const { data } = await sb
      .from("companies")
      .select("service_layer_url")
      .eq("company_db", companyDB)
      .maybeSingle();
    if (data?.service_layer_url) {
      let url = data.service_layer_url.replace(/\/+$/, "");
      if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
      else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
      return url;
    }
  } catch (e) {
    console.error("Failed to fetch SAP base URL:", e);
  }
  return DEFAULT_SAP_BASE_URL;
}

async function getConfiguredSapCompanyDb(companyDB: string): Promise<string> {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await sb
      .from("system_credentials")
      .select("credential_value")
      .eq("company_db", companyDB)
      .eq("system_name", "sap")
      .eq("credential_key", "company_db")
      .maybeSingle();

    if (error) throw error;
    const configured = data?.credential_value;
    return typeof configured === "string" && configured.trim() ? configured.trim() : companyDB;
  } catch (e) {
    console.error("Failed to fetch configured SAP CompanyDB:", e);
    return companyDB;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const reqBody = await req.json();
    const { action, credentials, endpoint, params, sessionId, routeId, table, database, companyDB } = reqBody;

    // Authentication is handled by SAP session (B1SESSION cookie).
    // Each action validates its own required params (sessionId, etc.).
    // Supabase auth is not required since users authenticate via SAP credentials.

    if (!action || typeof action !== "string") {
      return new Response(JSON.stringify({ error: "action é obrigatória" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SAP_BASE_URL = await getSapBaseUrl(companyDB || credentials?.CompanyDB);

    // LOGIN
    if (action === "login") {
      if (!credentials?.UserName || !credentials?.Password || !credentials?.CompanyDB) {
        return new Response(JSON.stringify({ error: "UserName, Password e CompanyDB são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const effectiveCompanyDB = await getConfiguredSapCompanyDb(companyDB || credentials.CompanyDB);

      const loginResp = await fetch(`${SAP_BASE_URL}/Login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          UserName: credentials.UserName,
          Password: credentials.Password,
          CompanyDB: effectiveCompanyDB,
        }),
      });

      if (!loginResp.ok) {
        const errorText = await loginResp.text();
        console.error("SAP Login error:", loginResp.status, errorText);
        let rawMsg = "";
        let sapCode: number | undefined;
        try {
          const parsed = JSON.parse(errorText);
          rawMsg = parsed?.error?.message?.value || "";
          sapCode = parsed?.error?.code;
        } catch { /* ignore */ }

        const lower = (rawMsg || errorText || "").toLowerCase();
        let friendly = "Não foi possível entrar. Verifique seus dados e tente novamente.";

        if (
          sapCode === -304 ||
          lower.includes("user name or password") ||
          lower.includes("invalid username or password") ||
          lower.includes("invalid credentials")
        ) {
          friendly = "Usuário ou senha incorretos.";
        } else if (sapCode === -131 || lower.includes("locked") || lower.includes("disabled")) {
          friendly = "Usuário bloqueado ou desativado no SAP. Procure o administrador.";
        } else if (sapCode === -306 || /none-sso/i.test(rawMsg)) {
          friendly = "Este usuário SAP é apenas SSO ou a empresa está mal configurada. Procure o administrador.";
        } else if (loginResp.status === 503 || loginResp.status === 502 || loginResp.status === 504) {
          friendly = "Servidor SAP indisponível no momento. Tente novamente em instantes.";
        } else if (loginResp.status >= 500) {
          friendly = "Erro no servidor SAP. Tente novamente em instantes.";
        }

        // Log completo apenas no servidor; usuário só vê a mensagem amigável.
        return new Response(JSON.stringify({ error: friendly, sapCode }), {
          status: loginResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const loginData = await loginResp.json();
      const setCookie = loginResp.headers.get("set-cookie") || "";
      const sessionMatch = setCookie.match(/B1SESSION=([^;]+)/);
      const routeMatch = setCookie.match(/ROUTEID=([^;]+)/);

      const sessionId = sessionMatch?.[1] || loginData.SessionId;
      const sessionTimeout = Number(loginData.SessionTimeout || 30);
      const expiresAt = Date.now() + Math.min(Math.max(sessionTimeout || 30, 1), 30) * 60 * 1000;
      const sapAuthToken = await signSapAuthToken({
        companyDB: companyDB || credentials.CompanyDB,
        userName: credentials.UserName,
        sessionId,
        expiresAt,
      });

      return new Response(JSON.stringify({
        sessionId,
        routeId: routeMatch?.[1] || "",
        sessionTimeout: loginData.SessionTimeout,
        sapAuthToken,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // QUERY
    if (action === "query") {
      if (!sessionId || !endpoint) {
        return new Response(JSON.stringify({ error: "sessionId e endpoint são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!validateEndpoint(endpoint)) {
        return new Response(JSON.stringify({ error: "endpoint inválido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const queryParams = new URLSearchParams();
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) queryParams.set(key, String(value));
        }
      }

      const queryString = queryParams.toString();
      const fullUrl = `${SAP_BASE_URL}/${endpoint}${queryString ? `?${queryString}` : ""}`;

      const cacheKey = `${sessionId}:${fullUrl}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ data: cached, fromCache: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cookies = `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
      let sapResp: Response;
      try {
        sapResp = await fetchWithTimeout(fullUrl, {
          method: "GET",
          headers: { "Content-Type": "application/json", Cookie: cookies },
        });
      } catch (e) {
        if (isAbortError(e)) {
          return new Response(JSON.stringify({ data: null, fromCache: false, timedOut: true }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw e;
      }

      if (!sapResp.ok) {
        const errorText = await sapResp.text();
        console.error("SAP query error:", sapResp.status, errorText);
        let errorMsg = "Erro na consulta SAP B1";
        try {
          const parsed = JSON.parse(errorText);
          errorMsg = parsed?.error?.message?.value || errorMsg;
        } catch { /* ignore */ }
        return new Response(JSON.stringify({ data: null, fromCache: false, sapStatus: sapResp.status, warning: errorMsg }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await sapResp.json();
      setCache(cacheKey, data);

      return new Response(JSON.stringify({ data, fromCache: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // QUERY ALL
    if (action === "queryAll") {
      if (!sessionId || !endpoint) {
        return new Response(JSON.stringify({ error: "sessionId e endpoint são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!validateEndpoint(endpoint)) {
        return new Response(JSON.stringify({ error: "endpoint inválido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cacheKey = `${sessionId}:all:${endpoint}:${JSON.stringify(params || {})}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ data: cached, fromCache: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cookies = `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
      const allResults: unknown[] = [];
      let skip = 0;
      const top = 500;
      let hasMore = true;
      const deadline = Date.now() + 140_000; // hard wall-clock budget < proxy idle 150s
      const HARD_CAP = 50_000;

      while (hasMore) {
        if (Date.now() > deadline) {
          console.warn(`SAP queryAll: deadline reached, returning ${allResults.length} partial results.`);
          break;
        }
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

        // SAP B1 occasionally drops the connection mid-response on long pages
        // ("connection closed before message completed"). Retry transient
        // network errors with backoff before giving up on the page.
        let sapResp: Response | null = null;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            sapResp = await fetchWithTimeout(fullUrl, {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                Cookie: cookies,
                // Ask SL to honor large page size (default PageSize is often 20)
                Prefer: "odata.maxpagesize=500",
              },
            });
            break;
          } catch (e) {
            lastErr = e;
            console.warn(
              `SAP queryAll fetch attempt ${attempt + 1} failed (skip=${skip}):`,
              e instanceof Error ? e.message : e,
            );
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }

        if (!sapResp) {
          console.error(
            "SAP queryAll: giving up after retries, returning partial results.",
            lastErr,
          );
          break;
        }

        if (!sapResp.ok) {
          console.error("SAP queryAll error:", sapResp.status, await sapResp.text());
          break;
        }

        let pageData: { value?: unknown[]; "odata.nextLink"?: string };
        try {
          pageData = await sapResp.json();
        } catch (e) {
          console.error(
            "SAP queryAll: failed to parse page body, returning partial.",
            e instanceof Error ? e.message : e,
          );
          break;
        }
        const items = pageData.value || [];
        allResults.push(...items);

        // SAP B1 Service Layer enforces its own PageSize (often 20), so
        // `items.length < top` does NOT mean we're done. Continue while the
        // page is non-empty OR an explicit nextLink is provided.
        const pageSize = items.length;
        hasMore = !!pageData["odata.nextLink"] || pageSize > 0;
        skip += pageSize > 0 ? pageSize : top;

        if (allResults.length >= HARD_CAP) hasMore = false;
      }

      const result = { value: allResults, totalCount: allResults.length };
      setCache(cacheKey, result);

      return new Response(JSON.stringify({ data: result, fromCache: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // QUERY VIEW
    if (action === "queryView") {
      if (!sessionId || !database || !table) {
        return new Response(JSON.stringify({ error: "sessionId, database e table são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (typeof database !== "string" || database.length > 200 || typeof table !== "string" || table.length > 200) {
        return new Response(JSON.stringify({ error: "database ou table inválidos" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Respect per-company toggle: when HANA DB queries are disabled, short-circuit with empty result.
      // Hooks that depend on these views already handle empty data gracefully.
      try {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: flag } = await sb
          .from("system_credentials")
          .select("credential_value")
          .eq("company_db", database)
          .eq("system_name", "sap")
          .eq("credential_key", "use_hana_db")
          .maybeSingle();
        if (flag?.credential_value === "false") {
          return new Response(JSON.stringify({ data: [], fromCache: false, hanaDisabled: true }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.warn("Could not read use_hana_db flag, defaulting to enabled:", e);
      }

      const tableName = extractTableName(table);
      const cacheKey = `${sessionId}:view:${database}:${tableName}:${JSON.stringify(params || {})}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ data: cached, fromCache: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const dynamicToken = await generateDynamicToken();
      const queryParams = new URLSearchParams({
        SessionId: sessionId,
        DB: database,
        Table: tableName,
        DynamicToken: dynamicToken,
        _t: String(Date.now()),
      });

      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null && key !== "SessionId" && key !== "DB" && key !== "Table") {
            queryParams.set(key, String(value));
          }
        }
      }

      let viewResp: Response;
      try {
        viewResp = await fetchWithTimeout(`${HANA_VIEWS_URL}?${queryParams.toString()}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-SessionId": sessionId,
            "X-DB": database,
            "X-Table": tableName,
            "X-Dynamic-Token": dynamicToken,
          },
        });
      } catch (e) {
        if (isAbortError(e)) {
          return new Response(JSON.stringify({ data: [], fromCache: false, hanaDisabled: true, timedOut: true }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw e;
      }

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
          status: viewResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rows = extractViewRows(payload);
      if (rows.length > 0) setCache(cacheKey, rows);

      return new Response(JSON.stringify({ data: rows, fromCache: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // APPROVALS CACHE (service-role proxy so SAP-authenticated users can use the shared cache)
    if (action === "readApprovalsCache" || action === "writeApprovalsCache") {
      try { await requireAuth(req); } catch {
        const payload = action === "readApprovalsCache"
          ? { data: null, updatedAt: null, expiresAt: null, authSkipped: true }
          : { success: false, authSkipped: true };
        return new Response(JSON.stringify(payload), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!companyDB || typeof companyDB !== "string") {
        return new Response(JSON.stringify({ error: "companyDB é obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

      if (action === "readApprovalsCache") {
        const { data, error } = await sb
          .from("sap_cache")
          .select("data, updated_at, expires_at")
          .eq("company_db", companyDB)
          .eq("cache_key", APPROVALS_CACHE_KEY)
          .maybeSingle();
        if (error) throw new Error(`Cache read failed: ${error.message}`);
        return new Response(JSON.stringify({ data: data?.data ?? null, updatedAt: data?.updated_at ?? null, expiresAt: data?.expires_at ?? null }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const docs = Array.isArray(reqBody.data) ? reqBody.data : [];
      const ttlMs = Number.isFinite(Number(reqBody.ttlMs)) ? Math.min(Math.max(Number(reqBody.ttlMs), 60_000), 60 * 60_000) : CACHE_TTL;
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      const { error } = await sb.from("sap_cache").upsert(
        { company_db: companyDB, cache_key: APPROVALS_CACHE_KEY, data: docs, expires_at: expiresAt },
        { onConflict: "cache_key,company_db" },
      );
      if (error) throw new Error(`Cache write failed: ${error.message}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SAP ACTION
    if (action === "sapAction") {
      if (!sessionId || !endpoint) {
        return new Response(JSON.stringify({ error: "sessionId e endpoint são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!validateEndpoint(endpoint)) {
        return new Response(JSON.stringify({ error: "endpoint inválido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const httpMethod = reqBody.method || "POST";
      const allowedMethods = ["POST", "PATCH", "PUT", "DELETE"];
      if (!allowedMethods.includes(httpMethod.toUpperCase())) {
        return new Response(JSON.stringify({ error: "Método HTTP não permitido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
        const errorMsg = extractSapErrorMessage(respData, "Erro na ação SAP B1");
        console.error("SAP action error:", sapResp.status, {
          endpoint,
          method: httpMethod,
          error: errorMsg,
          response: respData,
        });
        return new Response(JSON.stringify({ error: errorMsg, sapStatus: sapResp.status }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ data: respData }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DOWNLOAD ATTACHMENT — fetches a binary file from SAP Attachments2
    if (action === "downloadAttachment") {
      const attachmentEntry = Number(reqBody.attachmentEntry);
      const filename = typeof reqBody.filename === "string" ? reqBody.filename : "";
      if (!sessionId || !Number.isFinite(attachmentEntry) || attachmentEntry <= 0) {
        return new Response(JSON.stringify({ error: "sessionId e attachmentEntry são obrigatórios" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cookies = `B1SESSION=${sessionId}${routeId ? `; ROUTEID=${routeId}` : ""}`;
      const qs = filename ? `?filename='${encodeURIComponent(filename).replace(/'/g, "%27")}'` : "";
      const fullUrl = `${SAP_BASE_URL}/Attachments2(${attachmentEntry})/$value${qs}`;

      let sapResp: Response;
      try {
        sapResp = await fetchWithTimeout(fullUrl, {
          method: "GET",
          headers: { Cookie: cookies },
        }, 60_000);
      } catch (e) {
        if (isAbortError(e)) {
          return new Response(JSON.stringify({ error: "Tempo esgotado ao baixar anexo" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw e;
      }

      if (!sapResp.ok) {
        const errorText = await sapResp.text();
        console.error("SAP attachment download error:", sapResp.status, errorText.slice(0, 500));
        let errorMsg = "Erro ao baixar anexo do SAP";
        try {
          const parsed = JSON.parse(errorText);
          errorMsg = parsed?.error?.message?.value || errorMsg;
        } catch { /* binary or html */ }
        return new Response(JSON.stringify({ error: errorMsg, sapStatus: sapResp.status }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const buf = new Uint8Array(await sapResp.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        binary += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);
      const contentType = sapResp.headers.get("content-type") || "application/octet-stream";

      return new Response(JSON.stringify({
        data: base64,
        contentType,
        filename,
        size: buf.length,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida. Use: login, query, queryAll, queryView, sapAction, downloadAttachment, logout" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("sap-b1-proxy error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
