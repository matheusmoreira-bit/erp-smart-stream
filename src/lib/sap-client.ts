import { authFetch } from "@/lib/auth-fetch";

const FUNCTION_URL = "sap-b1-proxy";
const CREDENTIALS_FUNCTION_URL = "credentials";

export interface SapSession {
  sessionId: string;
  routeId: string;
  companyDB: string;
  userName: string;
  isSuperUser: boolean;
  erpType?: string;
}

// Client-side response cache
const clientCache = new Map<string, { data: unknown; expiry: number }>();
const CLIENT_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

function getClientCache(key: string): unknown | null {
  const entry = clientCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    clientCache.delete(key);
    return null;
  }
  return entry.data;
}

function setClientCache(key: string, data: unknown) {
  clientCache.set(key, { data, expiry: Date.now() + CLIENT_CACHE_TTL });
}

export function clearClientCache() {
  clientCache.clear();
}

async function callProxy(body: Record<string, unknown>) {
  const resp = await authFetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || `Erro HTTP ${resp.status}`);
  }
  return data;
}

async function getConfiguredSapCompanyDb(companyDB: string): Promise<string> {
  const resp = await authFetch(`${CREDENTIALS_FUNCTION_URL}?system=sap&company_db=${encodeURIComponent(companyDB)}&keys=company_db`, {
    method: "GET",
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || `Erro HTTP ${resp.status}`);
  }

  const configuredCompanyDb = data?.credentials?.find?.((row: { credential_key?: string; credential_value?: string }) => row.credential_key === "company_db")?.credential_value;
  return typeof configuredCompanyDb === "string" && configuredCompanyDb.trim() ? configuredCompanyDb.trim() : companyDB;
}

export async function sapLogin(userName: string, password: string, companyDB: string): Promise<SapSession> {
  const sapCompanyDb = await getConfiguredSapCompanyDb(companyDB);
  const result = await callProxy({
    action: "login",
    companyDB,
    credentials: { UserName: userName, Password: password, CompanyDB: sapCompanyDb },
  });

  const session: SapSession = {
    sessionId: result.sessionId,
    routeId: result.routeId || "",
    companyDB,
    userName,
    isSuperUser: false,
  };

  // Check if user is SAP SuperUser
  try {
    const userInfo = await callProxy({
      action: "query",
      sessionId: session.sessionId,
      routeId: session.routeId,
      companyDB,
      endpoint: `Users?$filter=UserCode eq '${userName}'&$select=UserCode,Superuser`,
    });
    const users = Array.isArray(userInfo.data) ? userInfo.data : (userInfo.data?.value || []);
    if (users.length > 0 && users[0].Superuser === "tYES") {
      session.isSuperUser = true;
    }
  } catch (e) {
    console.warn("Could not fetch SAP user superuser status:", e);
  }

  return session;
}

export async function sapLogout(session: SapSession): Promise<void> {
  clearClientCache();
  await callProxy({
    action: "logout",
    sessionId: session.sessionId,
    routeId: session.routeId,
  }).catch(() => {});
}

export async function sapQuery(
  session: SapSession,
  endpoint: string,
  params?: Record<string, string | number>,
  useCache = true,
): Promise<{ data: unknown; fromCache: boolean }> {
  const cacheKey = `${endpoint}:${JSON.stringify(params || {})}`;

  if (useCache) {
    const cached = getClientCache(cacheKey);
    if (cached) return { data: cached, fromCache: true };
  }

  const result = await callProxy({
    action: "query",
    sessionId: session.sessionId,
    routeId: session.routeId,
    companyDB: session.companyDB,
    endpoint,
    params,
  });

  if (useCache) {
    setClientCache(cacheKey, result.data);
  }

  return { data: result.data, fromCache: result.fromCache };
}

export async function sapAction(
  session: SapSession,
  endpoint: string,
  method: "POST" | "PATCH" = "POST",
  body?: Record<string, unknown>,
): Promise<{ data: unknown }> {
  const result = await callProxy({
    action: "sapAction",
    sessionId: session.sessionId,
    routeId: session.routeId,
    companyDB: session.companyDB,
    endpoint,
    method,
    body,
  });
  return { data: result.data };
}

export async function sapQueryView<T = unknown>(
  session: SapSession,
  table: string,
  params?: Record<string, string | number>,
  useCache = true,
): Promise<{ data: T[]; fromCache: boolean }> {
  const cacheKey = `view:${session.companyDB}:${table}:${JSON.stringify(params || {})}`;

  if (useCache) {
    const cached = getClientCache(cacheKey);
    if (cached) return { data: cached as T[], fromCache: true };
  }

  const result = await callProxy({
    action: "queryView",
    sessionId: session.sessionId,
    routeId: session.routeId,
    database: session.companyDB,
    table,
    params,
  });

  if (useCache) {
    setClientCache(cacheKey, result.data);
  }

  return { data: result.data as T[], fromCache: result.fromCache };
}

export async function sapQueryAll(
  session: SapSession,
  endpoint: string,
  params?: Record<string, string | number>,
  useCache = true,
): Promise<{ data: { value: unknown[]; totalCount: number }; fromCache: boolean }> {
  const cacheKey = `all:${endpoint}:${JSON.stringify(params || {})}`;

  if (useCache) {
    const cached = getClientCache(cacheKey);
    if (cached) return { data: cached as { value: unknown[]; totalCount: number }, fromCache: true };
  }

  const result = await callProxy({
    action: "queryAll",
    sessionId: session.sessionId,
    routeId: session.routeId,
    companyDB: session.companyDB,
    endpoint,
    params,
  });

  if (useCache) {
    setClientCache(cacheKey, result.data);
  }

  return { data: result.data, fromCache: result.fromCache };
}
