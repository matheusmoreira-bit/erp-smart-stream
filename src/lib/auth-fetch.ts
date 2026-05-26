import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Fetch wrapper that automatically uses the user's JWT for Authorization.
 */
export async function authFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error("Sessão expirada. Faça login no Backoffice novamente.");
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
