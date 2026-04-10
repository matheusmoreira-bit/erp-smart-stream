import { useState, useCallback } from "react";

interface CredentialMeta {
  id: string;
  system_name: string;
  credential_key: string;
  updated_at: string;
  company_db: string | null;
}

export function useCredentials() {
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const fetchCredentials = useCallback(async (companyDb?: string, system?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (system) params.set("system", system);
      if (companyDb) params.set("company_db", companyDb);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`${supabaseUrl}/functions/v1/credentials${qs}`, {
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

  const saveCredentials = useCallback(async (systemName: string, creds: { key: string; value: string }[], companyDb?: string) => {
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
        body: JSON.stringify({ system_name: systemName, credentials: creds, company_db: companyDb }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      await fetchCredentials(companyDb);

      // Audit
      const { logAuditAction } = await import("@/hooks/useAuditLog");
      await logAuditAction({ action: "save_credentials", entity_type: "system_credentials", entity_id: systemName, details: { companyDb, keys: creds.map(c => c.key) } });

      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar credenciais");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [supabaseUrl, anonKey, fetchCredentials]);

  const deleteCredentials = useCallback(async (systemName: string, companyDb?: string) => {
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
        body: JSON.stringify({ system_name: systemName, company_db: companyDb }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      await fetchCredentials(companyDb);

      // Audit
      const { logAuditAction } = await import("@/hooks/useAuditLog");
      await logAuditAction({ action: "delete_credentials", entity_type: "system_credentials", entity_id: systemName, details: { companyDb } });

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
