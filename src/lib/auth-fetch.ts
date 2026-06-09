import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Fetch wrapper that automatically uses the user's JWT for Authorization.
 * Falls back to anon key for edge functions that intentionally validate
 * their own non-Lovable auth context, such as the SAP session proxy.
 */
function tokenHasSub(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1] || ""));
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

  // If no valid user JWT, fall back to anon key. The called edge function
  // will decide whether the operation requires a real user and return its
  // own auth error — do NOT redirect or sign the user out here, since
  // many flows (e.g. SAP-only login) legitimately run without a Supabase
  // user session at first.
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
