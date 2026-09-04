/**
 * Configuração de runtime centralizada.
 * Único ponto de leitura de URLs/keys — futura migração para AWS troca esta camada.
 *
 * Mapeamento AWS equivalente:
 *  - VITE_SUPABASE_URL              → API Gateway (ex: https://api.erp-flow.com)
 *  - VITE_SUPABASE_PUBLISHABLE_KEY  → JWT público (Cognito hosted UI ou Auth0)
 *  - Edge Functions (/functions/v1) → Lambda + API Gateway path (/v1/<fn>)
 *  - Storage (Supabase Storage)     → S3 (bucket dedicado por tenant/kind)
 *  - Postgres (auth+rls nativos)    → RDS Postgres + PostgREST/Hasura para RLS
 */
const configuredBackendUrl = import.meta.env.VITE_SUPABASE_URL as string;

function resolveBackendUrl(url: string): string {
  if (!url?.startsWith("/") || typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString().replace(/\/$/, "");
}

const backendUrl = resolveBackendUrl(configuredBackendUrl);

function isLoopbackBackend(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

const localBackend =
  configuredBackendUrl?.startsWith("/") || isLoopbackBackend(backendUrl);
const localAuthEnabled =
  localBackend &&
  (import.meta.env.DEV || import.meta.env.VITE_DISABLE_GOOGLE_AUTH === "true");

export const runtime = {
  backendUrl,
  publicKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
  projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined,
  functionsBase: `${backendUrl}/functions/v1`,
  // Backend em loopback nunca usa OAuth real. A sessão local continua sendo
  // uma sessão Supabase válida para preservar RLS e permissões nos testes.
  disableGoogleAuth: localAuthEnabled,
  localAuthEmail: localAuthEnabled
    ? ((import.meta.env.VITE_LOCAL_AUTH_EMAIL as string | undefined) ??
      "matheus.moreira@anagaming.com.br")
    : undefined,
  localAuthPassword: localAuthEnabled
    ? (import.meta.env.VITE_LOCAL_AUTH_PASSWORD as string | undefined)
    : undefined,
  // Flag para futura troca — quando true, backend/impl carrega AWS impl.
  target: (import.meta.env.VITE_BACKEND_TARGET ?? "supabase") as
    "supabase" | "aws",
} as const;

export type BackendTarget = typeof runtime.target;
