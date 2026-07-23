/**
 * Implementação Supabase dos contratos definidos em ./types.
 * É apenas um proxy fino sobre o client atual — troca zero de comportamento.
 * A migração incremental substitui usos diretos do `supabase.*` por `backend.*`.
 */
import { supabase } from "@/integrations/supabase/client";
import type { AuthProvider, AuthSession, BackendClient, FunctionsInvoker, StorageProvider } from "./types";

const auth: AuthProvider = {
  async getSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return null;
    return {
      userId: data.session.user.id,
      email: data.session.user.email ?? null,
      accessToken: data.session.access_token,
    };
  },
  async signInWithPassword(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw error ?? new Error("no session");
    return { userId: data.session.user.id, email: data.session.user.email ?? null, accessToken: data.session.access_token };
  },
  async signInWithOAuth(provider) {
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) throw error;
  },
  async signOut() {
    await supabase.auth.signOut();
  },
  onAuthChange(cb) {
    const { data } = supabase.auth.onAuthStateChange((_ev, session) => {
      cb(session ? { userId: session.user.id, email: session.user.email ?? null, accessToken: session.access_token } : null);
    });
    return () => data.subscription.unsubscribe();
  },
};

const functions: FunctionsInvoker = {
  async invoke(name, body, headers) {
    const { data, error } = await supabase.functions.invoke(name, { body, headers });
    return { data: data as any, error: (error as Error | null) ?? null };
  },
};

const storage: StorageProvider = {
  async upload(bucket, path, file, opts) {
    const { data, error } = await supabase.storage.from(bucket).upload(path, file as any, {
      contentType: opts?.contentType,
      upsert: opts?.upsert ?? false,
    });
    if (error || !data) throw error ?? new Error("upload failed");
    return { path: data.path };
  },
  async download(bucket, path) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) throw error ?? new Error("download failed");
    return data;
  },
  getPublicUrl(bucket, path) {
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  },
  async createSignedUrl(bucket, path, expiresInSeconds) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw error ?? new Error("signed url failed");
    return data.signedUrl;
  },
  async remove(bucket, paths) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) throw error;
  },
};

export const supabaseBackend: BackendClient = { auth, functions, storage };
