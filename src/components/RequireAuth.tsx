import { useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { savePostLoginPath } from "@/lib/post-login-redirect";
import { Loader2 } from "lucide-react";

/** Rotas que podem ser abertas sem sessão autenticada. */
const PUBLIC_PATHS = ["/login"];
const PUBLIC_PREFIXES = ["/aprovar/"];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

/** Detecta o retorno do provedor OAuth (code/hash) para não redirecionar no meio do callback. */
function isAuthCallback(): boolean {
  const hash = window.location.hash || "";
  const search = window.location.search || "";
  return (
    hash.includes("access_token") ||
    hash.includes("refresh_token") ||
    /[?&]code=/.test(search)
  );
}

/**
 * Bloqueia qualquer tela que não seja de login para usuários sem sessão,
 * guardando o destino original para retomar depois da autenticação.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const publicRoute = useMemo(() => isPublicPath(location.pathname), [location.pathname]);

  if (publicRoute) return <>{children}</>;

  if (loading || isAuthCallback()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    savePostLoginPath(location.pathname + location.search);
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
