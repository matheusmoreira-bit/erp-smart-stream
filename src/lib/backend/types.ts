/**
 * Contratos de backend — camada de abstração para portabilidade.
 * Toda dependência de Supabase deve ser gradualmente movida para trás destes tipos.
 * A troca para AWS (Cognito + API Gateway + RDS + S3) implementa os mesmos contratos.
 */

export interface AuthSession {
  userId: string;
  email: string | null;
  accessToken: string;
}

export interface AuthProvider {
  getSession(): Promise<AuthSession | null>;
  signInWithPassword(email: string, password: string): Promise<AuthSession>;
  signInWithOAuth(provider: "google"): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: (session: AuthSession | null) => void): () => void;
}

export interface FunctionsInvoker {
  /** Invoca função server-side (Edge Function no Supabase, Lambda na AWS). */
  invoke<T = unknown>(name: string, body?: unknown, headers?: Record<string, string>): Promise<{ data: T | null; error: Error | null }>;
}

export interface StorageProvider {
  upload(bucket: string, path: string, file: Blob | Uint8Array, opts?: { contentType?: string; upsert?: boolean }): Promise<{ path: string }>;
  download(bucket: string, path: string): Promise<Blob>;
  getPublicUrl(bucket: string, path: string): string;
  createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

export interface BackendClient {
  auth: AuthProvider;
  functions: FunctionsInvoker;
  storage: StorageProvider;
}
