import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Fetch wrapper for protected edge functions. It only sends a real user JWT;
 * public/SAP-session functions must use publicFunctionFetch instead.
 */
function tokenHasSub(token: string): boolean {
  try {
    const rawPayload = token.split(".")[1] || "";
    const base64 = rawPayload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(rawPayload.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64));
    return typeof payload?.sub === "string" && payload.sub.length > 0;
  } catch {
    return false;
  }
}

async function getValidAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token && tokenHasSub(session.access_token)) {
    return session.access_token;
  }
  // Try a non-destructive refresh. NEVER call signOut() here — that wipes the
  // user's Lovable Cloud session globally and breaks every subsequent
  // supabase.from() call (which would then run as anon and 401).
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session?.access_token && tokenHasSub(data.session.access_token)) {
      return data.session.access_token;
    }
  } catch { /* ignore */ }
  return null;
}

export async function authFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getValidAccessToken();
  if (!token) {
    return new Response(JSON.stringify({ error: "Faça login no Backoffice para acessar esta função." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = path.startsWith("http") ? path : `${SUPABASE_URL}/functions/v1/${path}`;

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
    },
  });
}

export async function publicFunctionFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getValidAccessToken();
  const authToken = token || ANON_KEY;
  const url = path.startsWith("http") ? path : `${SUPABASE_URL}/functions/v1/${path}`;

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${authToken}`,
      apikey: ANON_KEY,
    },
  });
}

/**
 * Fetch for edge functions that should work for SAP-authenticated users even
 * when there's no Lovable Cloud session. Injects SAP session headers when
 * available so the server can validate via SAP Service Layer.
 */
function readSapHeaders(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem("erp_session_v1");
    if (!raw) return {};
    const s = JSON.parse(raw);
    if (s?.erpType !== "sap" || !s.sessionId || !s.userName || !s.companyDB) return {};
    return {
      "x-sap-session": s.sessionId,
      "x-sap-route": s.routeId || "",
      "x-sap-user": s.userName,
      "x-company-db": s.companyDB,
    };
  } catch {
    return {};
  }
}

export async function sapFunctionFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return publicFunctionFetch(path, {
    ...options,
    headers: {
      ...readSapHeaders(),
      ...options.headers,
    },
  });
}

