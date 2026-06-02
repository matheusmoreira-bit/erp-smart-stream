import { supabase } from "@/integrations/supabase/client";
import { authFetch } from "@/lib/auth-fetch";

const FUNCTION_URL = "sap-b1-proxy";

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
  if (!resp.ok || data?.error) {
    throw new Error(data?.error || `Erro HTTP ${resp.status}`);
  }
  return data;
}

async function hasLovableSession(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return Boolean(session?.access_token);
}

export async function sapLogin(userName: string, password: string, companyDB: string): Promise<SapSession> {
  const result = await callProxy({
    action: "login",
    companyDB,
    credentials: { UserName: userName, Password: password, CompanyDB: companyDB },
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

export async function sapDownloadAttachment(
  session: SapSession,
  attachmentEntry: number,
  filename: string,
): Promise<{ blob: Blob; contentType: string; filename: string }> {
  const result = await callProxy({
    action: "downloadAttachment",
    sessionId: session.sessionId,
    routeId: session.routeId,
    companyDB: session.companyDB,
    attachmentEntry,
    filename,
  });
  if (!result?.data || typeof result.data !== "string") {
    throw new Error(result?.error || "Falha ao baixar anexo");
  }
  const binary = atob(result.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const contentType = result.contentType || "application/octet-stream";
  return { blob: new Blob([bytes], { type: contentType }), contentType, filename: result.filename || filename };
}

export async function sapQueryView<T = unknown>(

  session: SapSession,
  table: string,
  params?: Record<string, string | number>,
  useCache = true,
): Promise<{ data: T[]; fromCache: boolean; hanaDisabled?: boolean }> {
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

  if (useCache && !result.hanaDisabled) {
    setClientCache(cacheKey, result.data);
  }

  return { data: result.data as T[], fromCache: result.fromCache, hanaDisabled: !!result.hanaDisabled };
}

export async function sapReadApprovalsCache<T = unknown>(
  session: SapSession,
): Promise<{ data: T | null; updatedAt: string | null; expiresAt: string | null }> {
  try {
    if (!(await hasLovableSession())) {
      return { data: null, updatedAt: null, expiresAt: null };
    }

    const result = await callProxy({
      action: "readApprovalsCache",
      sessionId: session.sessionId,
      routeId: session.routeId,
      companyDB: session.companyDB,
    });
    return {
      data: (result.data ?? null) as T | null,
      updatedAt: result.updatedAt ?? null,
      expiresAt: result.expiresAt ?? null,
    };
  } catch (e) {
    // Cache is an optimization — degrade silently if unauthenticated/unavailable
    console.warn("readApprovalsCache skipped:", (e as Error).message);
    return { data: null, updatedAt: null, expiresAt: null };
  }
}

export async function sapWriteApprovalsCache<T = unknown>(
  session: SapSession,
  docs: T,
  ttlMs: number,
): Promise<void> {
  try {
    if (!(await hasLovableSession())) {
      return;
    }

    await callProxy({
      action: "writeApprovalsCache",
      sessionId: session.sessionId,
      routeId: session.routeId,
      companyDB: session.companyDB,
      data: docs,
      ttlMs,
    });
  } catch (e) {
    console.warn("writeApprovalsCache skipped:", (e as Error).message);
  }
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
