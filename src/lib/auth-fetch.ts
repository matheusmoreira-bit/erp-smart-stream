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
  let { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token && tokenHasSub(session.access_token)) {
    return session.access_token;
  }
  // Try to refresh — stale tokens (e.g. signed by old keys) won't have a sub claim
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token || !tokenHasSub(data.session.access_token)) {
    // Stale/invalid session — clear it so the app re-prompts login cleanly
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    return null;
  }
  return data.session.access_token;
}

export async function authFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = (await getValidAccessToken()) || ANON_KEY;

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
