import { supabase } from "@/integrations/supabase/client";
import { publicFunctionFetch } from "@/lib/auth-fetch";
import { toast } from "sonner";

const FUNCTION_URL = "sap-b1-proxy";

// Timeout & retry configuration for SAP calls.
const REQUEST_TIMEOUT_MS = 45_000; // hard cap per attempt
const SLOW_WARNING_MS = 8_000;     // show "SAP está lento" toast after this
const MAX_RETRIES = 2;             // total attempts = MAX_RETRIES + 1
const BACKOFF_BASE_MS = 600;       // 600ms, 1800ms (+jitter)

// Actions that are safe to retry automatically (idempotent reads).
const RETRIABLE_ACTIONS = new Set([
  "query",
  "queryAll",
  "queryView",
  "downloadAttachment",
  "readApprovalsCache",
]);

export interface SapSession {
  sessionId: string;
  routeId: string;
  companyDB: string;
  userName: string;
  isSuperUser: boolean;
  erpType?: string;
  expiresAt?: number;
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

export class SapSessionExpiredError extends Error {
  constructor(message = "Sessão SAP expirada. Faça login novamente.") {
    super(message);
    this.name = "SapSessionExpiredError";
  }
}

export class SapTimeoutError extends Error {
  constructor(message = "SAP demorou demais para responder. Tente novamente em instantes.") {
    super(message);
    this.name = "SapTimeoutError";
  }
}

function looksLikeSessionExpired(payload: { sapStatus?: number; warning?: string; error?: string } | null | undefined): boolean {
  if (!payload) return false;
  if (payload.sapStatus === 401) return true;
  const msg = `${payload.warning || ""} ${payload.error || ""}`.toLowerCase();
  return /invalid session|session expired|session has expired|not logged in|login again|-304\b/.test(msg);
}

function notifySessionExpired() {
  clearClientCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("erp:session-expired"));
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientHttpStatus(status: number | undefined): boolean {
  if (!status) return false;
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

async function doFetchWithTimeout(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await publicFunctionFetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callProxy(body: Record<string, unknown>): Promise<any> {
  const action = typeof body?.action === "string" ? body.action : "";
  const canRetry = RETRIABLE_ACTIONS.has(action);
  const maxAttempts = canRetry ? MAX_RETRIES + 1 : 1;

  let slowToastId: string | number | undefined;
  const scheduleSlowToast = () => {
    if (typeof window === "undefined") return undefined;
    return setTimeout(() => {
      slowToastId = toast.loading("O SAP está lento agora — aguardando resposta…", {
        duration: Infinity,
      });
    }, SLOW_WARNING_MS);
  };
  const dismissSlowToast = (timerId: ReturnType<typeof setTimeout> | undefined) => {
    if (timerId) clearTimeout(timerId);
    if (slowToastId !== undefined) {
      toast.dismiss(slowToastId);
      slowToastId = undefined;
    }
  };

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const slowTimer = scheduleSlowToast();
    let resp: Response;
    try {
      resp = await doFetchWithTimeout(body, REQUEST_TIMEOUT_MS);
    } catch (err) {
      dismissSlowToast(slowTimer);
      const aborted = err instanceof DOMException && err.name === "AbortError";
      lastError = aborted ? new SapTimeoutError() : err;
      if (attempt < maxAttempts && canRetry) {
        const wait = BACKOFF_BASE_MS * Math.pow(3, attempt - 1) + Math.floor(Math.random() * 300);
        toast.message(
          aborted
            ? `SAP não respondeu a tempo. Tentando novamente (${attempt + 1}/${maxAttempts})…`
            : `Falha de rede ao chamar SAP. Tentando novamente (${attempt + 1}/${maxAttempts})…`,
        );
        await sleep(wait);
        continue;
      }
      if (aborted) throw lastError;
      throw err instanceof Error ? err : new Error(String(err));
    }

    // Server responded — try to parse body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
    dismissSlowToast(slowTimer);

    // Skip expiry detection on the login action itself — wrong creds shouldn't trigger a global logout
    if (action !== "login" && looksLikeSessionExpired(data)) {
      notifySessionExpired();
      throw new SapSessionExpiredError();
    }

    const httpErr = !resp.ok;
    const bodyErr = !!data?.error;
    if (httpErr || bodyErr) {
      const transient = isTransientHttpStatus(resp.status) || isTransientHttpStatus(data?.sapStatus);
      const message = data?.error || `Erro HTTP ${resp.status}`;
      lastError = new Error(message);
      if (transient && canRetry && attempt < maxAttempts) {
        const wait = BACKOFF_BASE_MS * Math.pow(3, attempt - 1) + Math.floor(Math.random() * 300);
        toast.message(
          `SAP retornou erro temporário (${resp.status}). Tentando novamente (${attempt + 1}/${maxAttempts})…`,
        );
        await sleep(wait);
        continue;
      }
      throw lastError;
    }

    return data as Record<string, unknown>;
  }

  throw lastError instanceof Error ? lastError : new Error("Falha ao chamar o SAP após múltiplas tentativas.");
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

  // SAP Service Layer SessionTimeout is in minutes (default 30).
  const timeoutMin = Number.isFinite(result.sessionTimeout) && result.sessionTimeout > 0
    ? Math.min(Number(result.sessionTimeout), 30)
    : 30;
  const session: SapSession = {
    sessionId: result.sessionId,
    routeId: result.routeId || "",
    companyDB,
    userName,
    isSuperUser: false,
    expiresAt: Date.now() + timeoutMin * 60 * 1000,
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
  const cacheKey = `${session.companyDB}:${endpoint}:${JSON.stringify(params || {})}`;

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
  const cacheKey = `all:${session.companyDB}:${endpoint}:${JSON.stringify(params || {})}`;

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
