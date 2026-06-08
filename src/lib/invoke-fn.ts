import { supabase } from "@/integrations/supabase/client";

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
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !tokenHasSub(session.access_token)) {
    try {
      await supabase.auth.refreshSession();
    } catch { /* ignore — invoke will fail below if still bad */ }
  }
  return supabase.functions.invoke<T>(name, options);
}
