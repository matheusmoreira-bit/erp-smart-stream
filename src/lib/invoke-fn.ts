import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function tokenHasSub(token?: string | null): boolean {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1] || ""));
    return typeof payload?.sub === "string" && payload.sub.length > 0;
  } catch {
    return false;
  }
}

/**
 * Calls a protected edge function with the current Lovable Cloud user JWT.
 * Public/SAP-session functions should use publicFunctionFetch from auth-fetch.
 */
export async function invokeFn<T = any>(
  name: string,
  options?: Parameters<typeof supabase.functions.invoke>[1],
) {
  let { data: { session } } = await supabase.auth.getSession();
  let authToken = session?.access_token && tokenHasSub(session.access_token) ? session.access_token : null;

  if (!session?.access_token || !tokenHasSub(session.access_token)) {
    try {
      const refreshed = await supabase.auth.refreshSession();
      session = refreshed.data.session;
      authToken = session?.access_token && tokenHasSub(session.access_token) ? session.access_token : null;
    } catch { /* ignore — invoke will fail below if still bad */ }
  }

  if (!authToken) {
    return {
      data: null,
      error: new Error("Faça login no Backoffice para acessar esta função."),
    };
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
      Authorization: `Bearer ${authToken}`,
      apikey: ANON_KEY,
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data: T | null = null;
  try {
    data = text ? JSON.parse(text) as T : null;
  } catch {
    data = null;
  }

  return {
    data,
    error: response.ok ? null : new Error(`Edge function returned ${response.status}: ${text}`),
  };
}
