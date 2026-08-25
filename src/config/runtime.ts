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
export const runtime = {
  backendUrl: import.meta.env.VITE_SUPABASE_URL as string,
  publicKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
  projectId: import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined,
  functionsBase: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`,
  disableGoogleAuth:
    import.meta.env.DEV && import.meta.env.VITE_DISABLE_GOOGLE_AUTH === "true",
  localAuthEmail: import.meta.env.DEV
    ? import.meta.env.VITE_LOCAL_AUTH_EMAIL as string | undefined
    : undefined,
  localAuthPassword: import.meta.env.DEV
    ? import.meta.env.VITE_LOCAL_AUTH_PASSWORD as string | undefined
    : undefined,
  // Flag para futura troca — quando true, backend/impl carrega AWS impl.
  target: (import.meta.env.VITE_BACKEND_TARGET ?? "supabase") as "supabase" | "aws",
} as const;

export type BackendTarget = typeof runtime.target;
