import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

type SapSessionValidation = {
  id: string;
  email: string;
  companyDB: string;
  userName: string;
  source: "sap_session";
};

const SAP_SESSION_VALIDATION_CACHE_TTL_MS = 60_000;
const sapSessionValidationCache = new Map<string, { expiresAt: number; value: SapSessionValidation }>();
const encoder = new TextEncoder();

function getSapSessionValidationCacheKey(companyDB: string, sapUser: string, sapSession: string, routeId: string) {
  return `${companyDB}:${sapUser}:${sapSession}:${routeId}`;
}

function pruneSapSessionValidationCache() {
  if (sapSessionValidationCache.size <= 500) return;
  const now = Date.now();
  for (const [key, entry] of sapSessionValidationCache) {
    if (entry.expiresAt <= now) sapSessionValidationCache.delete(key);
  }
}

function tokenPayloadHasSub(token: string): boolean {
  try {
    const rawPayload = token.split(".")[1] || "";
    const base64 = rawPayload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(rawPayload.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64));
    return typeof payload?.sub === "string" && payload.sub.length > 0;
  } catch {
    return false;
  }
}

function base64UrlDecodeToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifySapAuthToken(
  token: string,
  sapSession: string,
  sapUser: string,
  companyDB: string,
): Promise<SapSessionValidation | null> {
  const secret = Deno.env.get("SAP_MIDDLEWARE_SECRET") || "";
  if (!secret || !token) return null;
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart || token.split(".").length !== 2) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payloadPart)));
  const received = base64UrlDecodeToBytes(signaturePart);
  if (!timingSafeEqual(expected, received)) return null;

  const payloadBytes = base64UrlDecodeToBytes(payloadPart);
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
    companyDB?: string;
    userName?: string;
    sidHash?: string;
    exp?: number;
  };
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSeconds) return null;
  if (payload.companyDB !== companyDB || payload.userName !== sapUser) return null;
  if (payload.sidHash !== await sha256Base64Url(sapSession)) return null;

  return {
    id: `sap:${companyDB}:${sapUser}`,
    email: sapUser,
    companyDB,
    userName: sapUser,
    source: "sap_session",
  };
}

/**
 * Require an authenticated Supabase user. Throws AuthError on failure.
 *
 * Prefers local JWT verification via getClaims()/JWKS to avoid intermittent
 * 401s caused by network/rate-limit issues calling /auth/v1/user. Falls back
 * to getUser() when getClaims() is unavailable.
 */
export async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new AuthError("Não autenticado", 401);
  }
  const token = authHeader.slice(7).trim();

  // Reject anon/publishable keys — they don't represent a user
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  if (!token || token === anonKey || token === publishableKey) {
    throw new AuthError("Não autenticado", 401);
  }

  // The web app may call SAP-session endpoints with the public key as bearer
  // when no Cloud user is signed in. That token has no user `sub`; reject it
  // locally instead of spending ~1s on getClaims/getUser calls that will fail.
  if (!tokenPayloadHasSub(token)) {
    throw new AuthError("Não autenticado", 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    anonKey || publishableKey,
  );

  // 1) Local JWKS verification (preferred, no network round-trip).
  try {
    const anyAuth = supabase.auth as unknown as {
      getClaims?: (
        jwt: string,
      ) => Promise<{
        data: { claims?: { sub?: string; email?: string } } | null;
        error: unknown;
      }>;
    };
    if (typeof anyAuth.getClaims === "function") {
      const { data, error } = await anyAuth.getClaims(token);
      const sub = data?.claims?.sub;
      if (!error && sub) {
        return { id: sub, email: data?.claims?.email || null };
      }
      console.warn("[requireUser] getClaims failed", {
        error: error ? String((error as Error).message || error) : null,
        hasData: !!data,
      });
    } else {
      console.warn("[requireUser] getClaims not available on supabase.auth");
    }
  } catch (e) {
    console.warn("[requireUser] getClaims threw", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 2) Fallback: server-side validation via /auth/v1/user.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    console.warn("[requireUser] getUser failed", {
      error: error ? String((error as Error).message || error) : null,
      tokenPrefix: token.slice(0, 24),
    });
    throw new AuthError("Não autenticado", 401);
  }
  return { id: data.user.id, email: data.user.email || null };
}

/**
 * Require an authenticated user that has the 'admin' role.
 */
export async function requireAdmin(req: Request) {
  const user = await requireUser(req);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (error || data !== true) {
    throw new AuthError("Acesso negado — apenas administradores", 403);
  }
  return user;
}

async function getSapBaseUrl(admin: ReturnType<typeof createClient>, companyDB: string): Promise<string> {
  const fallback = Deno.env.get("SAP_DEFAULT_BASE_URL") || "https://jyl32uqm9176-sl.s1p-zona-01-4fd9831d6a58.saas.wevy.cloud/b1s/v2";
  const { data } = await admin
    .from("system_credentials")
    .select("credential_value")
    .eq("company_db", companyDB)
    .eq("system_name", "sap")
    .eq("credential_key", "service_layer_url")
    .maybeSingle();

  const rawUrl = typeof data?.credential_value === "string" && data.credential_value.trim()
    ? data.credential_value.trim()
    : fallback;
  let url = rawUrl.replace(/\/+$/, "");
  if (url.includes("/b1s/v1")) url = url.replace("/b1s/v1", "/b1s/v2");
  else if (!url.includes("/b1s/v2")) url = `${url}/b1s/v2`;
  return url;
}

async function validateSapAdmin(req: Request) {
  const sapSession = req.headers.get("x-sap-session")?.trim();
  const routeId = req.headers.get("x-sap-route")?.trim() || "";
  const sapUser = req.headers.get("x-sap-user")?.trim();
  const companyDB = req.headers.get("x-company-db")?.trim();
  if (!sapSession || !sapUser || !companyDB) {
    console.warn("[validateSapAdmin] missing SAP headers", {
      hasSession: !!sapSession,
      hasUser: !!sapUser,
      hasCompanyDB: !!companyDB,
    });
    return null;
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: isAdminByMapping } = await admin.rpc("is_sap_user_admin", {
    _sap_username: sapUser.toLowerCase(),
  });
  const isManager = sapUser.toLowerCase() === "manager";

  const escapedUser = sapUser.replace(/'/g, "''");
  const baseUrl = await getSapBaseUrl(admin, companyDB);
  const params = new URLSearchParams({
    "$filter": `UserCode eq '${escapedUser}'`,
    "$select": "UserCode,Superuser",
  });
  const sapResp = await fetch(
    `${baseUrl}/Users?${params.toString()}`,
    { headers: { Cookie: `B1SESSION=${sapSession}${routeId ? `; ROUTEID=${routeId}` : ""}` } },
  );
  if (!sapResp.ok) {
    const t = await sapResp.text().catch(() => "");
    console.warn("[validateSapAdmin] SAP Users probe failed", {
      status: sapResp.status,
      companyDB,
      sapUser,
      body: t.slice(0, 200),
    });
    return null;
  }

  const payload = await sapResp.json().catch(() => null) as { value?: { Superuser?: string }[] } | null;
  const isSapSuperUser = payload?.value?.some((row) => row.Superuser === "tYES") === true;
  if (!isManager && !isSapSuperUser && isAdminByMapping !== true) {
    console.warn("[validateSapAdmin] user is not admin", {
      sapUser,
      companyDB,
      isManager,
      isSapSuperUser,
      isAdminByMapping,
    });
    return null;
  }

  return { id: `sap:${companyDB}:${sapUser}`, email: sapUser, companyDB, userName: sapUser, source: "sap_admin" as const };
}

export async function requireAdminOrSapAdmin(req: Request) {
  try {
    return await requireAdmin(req);
  } catch (err) {
    const sapAdmin = await validateSapAdmin(req);
    if (sapAdmin) return sapAdmin;
    throw err;
  }
}

export async function requireAdminOrSapSession(req: Request) {
  try {
    const user = await requireAdmin(req);
    return { ...user, source: "cloud_admin" as const };
  } catch (err) {
    const sap = await validateSapSession(req);
    if (sap) return sap;
    throw err;
  }
}

/**
 * Lightweight variant: accepts a caller that declared SAP session headers
 * without probing SAP. Only safe for endpoints that return non-sensitive
 * metadata (no credential values, no PII). Falls back to Cloud admin auth.
 */
export async function requireAdminOrSapSessionHeaders(req: Request) {
  try {
    const user = await requireAdmin(req);
    return { ...user, source: "cloud_admin" as const };
  } catch (err) {
    const sapSession = req.headers.get("x-sap-session")?.trim();
    const sapUser = req.headers.get("x-sap-user")?.trim();
    const companyDB = req.headers.get("x-company-db")?.trim();
    if (sapSession && sapUser && companyDB) {
      return {
        id: `sap:${companyDB}:${sapUser}`,
        email: sapUser,
        companyDB,
        userName: sapUser,
        source: "sap_headers" as const,
      };
    }
    throw err;
  }
}

/**
 * Validate that the caller has a valid SAP B1 session (any user). Used by
 * ERP-facing edge functions where the user may not have a Lovable Cloud
 * account at all (e.g. PagCorp listing).
 */
export async function validateSapSession(req: Request) {
  const sapSession = req.headers.get("x-sap-session")?.trim();
  const routeId = req.headers.get("x-sap-route")?.trim() || "";
  const sapUser = req.headers.get("x-sap-user")?.trim();
  const companyDB = req.headers.get("x-company-db")?.trim();
  if (!sapSession || !sapUser || !companyDB) return null;

  const cacheKey = getSapSessionValidationCacheKey(companyDB, sapUser, sapSession, routeId);
  const cached = sapSessionValidationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const signed = await verifySapAuthToken(req.headers.get("x-sap-auth-token")?.trim() || "", sapSession, sapUser, companyDB);
    if (signed) {
      sapSessionValidationCache.set(cacheKey, {
        expiresAt: Date.now() + SAP_SESSION_VALIDATION_CACHE_TTL_MS,
        value: signed,
      });
      pruneSapSessionValidationCache();
      return signed;
    }
  } catch (e) {
    console.warn("[validateSapSession] signed token validation failed; falling back to SAP probe", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const baseUrl = await getSapBaseUrl(admin, companyDB);
  // Cheap session-scoped check. We can't hit /Users because regular (non-super)
  // B1 users get 403 "not permitted to query the object:Users" — which would
  // wrongly look like an invalid session. Probe the caller's own record via
  // /Users('<code>'), and if SAP still refuses (older SL versions), fall back
  // to the service-document root which any valid B1SESSION can read.
  const cookie = `B1SESSION=${sapSession}${routeId ? `; ROUTEID=${routeId}` : ""}`;
  const escaped = sapUser.replace(/'/g, "''");
  let resp = await fetch(`${baseUrl}/Users('${encodeURIComponent(escaped)}')?$select=UserCode`, {
    headers: { Cookie: cookie },
  });
  // 401 = bad session. 403/404 = session is fine, permission/lookup issue.
  if (resp.status === 401) {
    sapSessionValidationCache.delete(cacheKey);
    return null;
  }
  if (!resp.ok && resp.status !== 403 && resp.status !== 404) {
    // Fallback: service-document root requires only a valid session.
    await resp.body?.cancel().catch(() => {});
    resp = await fetch(`${baseUrl}/`, { headers: { Cookie: cookie } });
    if (resp.status === 401) {
      sapSessionValidationCache.delete(cacheKey);
      return null;
    }
    if (!resp.ok) return null;
  }
  await resp.body?.cancel().catch(() => {});
  const value: SapSessionValidation = {
    id: `sap:${companyDB}:${sapUser}`,
    email: sapUser,
    companyDB,
    userName: sapUser,
    source: "sap_session",
  };
  sapSessionValidationCache.set(cacheKey, {
    expiresAt: Date.now() + SAP_SESSION_VALIDATION_CACHE_TTL_MS,
    value,
  });
  pruneSapSessionValidationCache();
  return value;
}

export async function requireUserOrSapSession(req: Request) {
  try {
    return await requireUser(req);
  } catch (err) {
    const sap = await validateSapSession(req);
    if (sap) return sap;
    throw err;
  }
}

/**
 * Lightweight variant of requireUserOrSapSession: accepts SAP session
 * headers without probing SAP. Safe for endpoints that only read/write
 * non-sensitive metadata scoped by company_db (no credential values, no
 * PII). Avoids 401s when the SAP session has expired on the server side.
 */
export async function requireUserOrSapSessionHeaders(req: Request) {
  try {
    return await requireUser(req);
  } catch (err) {
    const sapSession = req.headers.get("x-sap-session")?.trim();
    const sapUser = req.headers.get("x-sap-user")?.trim();
    const companyDB = req.headers.get("x-company-db")?.trim();
    if (sapSession && sapUser && companyDB) {
      return {
        id: `sap:${companyDB}:${sapUser}`,
        email: sapUser,
        companyDB,
        userName: sapUser,
        source: "sap_headers" as const,
      };
    }
    throw err;
  }
}

export function authErrorResponse(err: unknown, corsHeaders: Record<string, string>) {
  if (err instanceof AuthError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}
