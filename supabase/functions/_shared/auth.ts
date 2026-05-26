import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * Require an authenticated Supabase user. Throws AuthError on failure.
 */
export async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new AuthError("Não autenticado", 401);
  }
  const token = authHeader.slice(7).trim();

  // Reject anon/publishable keys — they don't represent a user
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  if (token === anonKey || token === publishableKey) {
    throw new AuthError("Não autenticado", 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    anonKey || publishableKey,
  );

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new AuthError("Não autenticado", 401);
  return { id: data.claims.sub as string, email: (data.claims.email as string) || null };
}

/**
 * Require an authenticated user that has the 'admin' role.
 */
export async function requireAdmin(req: Request) {
  const user = await requireUser(req);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (error || data !== true) {
    throw new AuthError("Acesso negado — apenas administradores", 403);
  }
  return user;
}

export function authErrorResponse(err: unknown, corsHeaders: Record<string, string>) {
  if (err instanceof AuthError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}
