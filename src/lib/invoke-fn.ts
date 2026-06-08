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
 * Wrapper around supabase.functions.invoke that guarantees the JWT sent to
 * the edge function has a valid `sub` claim. If the cached session token is
 * corrupt, it attempts a non-destructive refresh before invoking — preventing
 * spurious 401 "Não autenticado" errors from requireUser().
 */
export async function invokeFn<T = any>(
  name: string,
  options?: Parameters<typeof supabase.functions.invoke>[1],
) {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !tokenHasSub(session.access_token)) {
    try {
      const refreshed = await supabase.auth.refreshSession();
      session = refreshed.data.session;
    } catch { /* ignore — invoke will fail below if still bad */ }
  }

  if (!session?.access_token || !tokenHasSub(session.access_token)) {
    return {
      data: null,
      error: new Error("Sessão inválida ou expirada. Faça login pela tela antes de integrar."),
    };
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
      Authorization: `Bearer ${session.access_token}`,
      apikey: ANON_KEY,
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) as T : null;

  return {
    data,
    error: response.ok ? null : new Error(`Edge function returned ${response.status}: ${text}`),
  };
}
