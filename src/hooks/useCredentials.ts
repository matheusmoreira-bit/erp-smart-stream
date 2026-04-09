import { useState, useCallback } from "react";

interface CredentialMeta {
  id: string;
  system_name: string;
  credential_key: string;
  updated_at: string;
}

export function useCredentials() {
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const fetchCredentials = useCallback(async (system?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = system ? `?system=${encodeURIComponent(system)}` : "";
      const res = await fetch(`${supabaseUrl}/functions/v1/credentials${params}`, {
        headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      setCredentials(data.credentials || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar credenciais");
    } finally {
      setIsLoading(false);
    }
  }, [supabaseUrl, anonKey]);

  const saveCredentials = useCallback(async (systemName: string, creds: { key: string; value: string }[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/credentials`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ system_name: systemName, credentials: creds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      await fetchCredentials();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar credenciais");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [supabaseUrl, anonKey, fetchCredentials]);

  const deleteCredentials = useCallback(async (systemName: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/credentials`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ system_name: systemName }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      await fetchCredentials();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao remover credenciais");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [supabaseUrl, anonKey, fetchCredentials]);

  const hasCredentials = useCallback((system: string) => {
    return credentials.some(c => c.system_name === system);
  }, [credentials]);

  return { credentials, isLoading, error, fetchCredentials, saveCredentials, deleteCredentials, hasCredentials };
}
