import { useState, useCallback } from "react";
import { sapFunctionFetch } from "@/lib/auth-fetch";

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
  // `lastFetchOk` só vira true depois de um GET bem-sucedido. Enquanto ele for
  // false, `credentials = []` NÃO significa "não cadastrado" — significa "ainda
  // não sei" (carregando ou última leitura falhou). Isso evita o falso alarme
  // "Credencial não cadastrada" quando o fetch sofre um erro transiente
  // (cold start da function, 401 durante refresh do token, timeout de rede).
  const [lastFetchOk, setLastFetchOk] = useState(false);

  const credentialsFetch = useCallback((path: string, options: RequestInit = {}) => {
    return sapFunctionFetch(path, options);
  }, []);

  const fetchCredentials = useCallback(async (companyDb?: string, system?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (system) params.set("system", system);
      if (companyDb) params.set("company_db", companyDb);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await credentialsFetch(`credentials${qs}`);
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      setCredentials(data.credentials || []);
      setLastFetchOk(true);
    } catch (e) {
      // Erro de leitura NÃO deve zerar o estado — o cadastro no banco continua
      // válido; apenas não conseguimos confirmar agora. Mantém a última lista
      // conhecida e marca lastFetchOk=false para os chamadores diferenciarem.
      setError(e instanceof Error ? e.message : "Erro ao buscar credenciais");
      setLastFetchOk(false);
    } finally {
      setIsLoading(false);
    }
  }, [credentialsFetch]);

  const saveCredentials = useCallback(async (systemName: string, creds: { key: string; value: string }[], companyDb?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await credentialsFetch("credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_name: systemName, credentials: creds, company_db: companyDb }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${res.status}`);
      }
      await fetchCredentials(companyDb);

      const { logAuditAction } = await import("@/hooks/useAuditLog");
      await logAuditAction({ action: "save_credentials", entity_type: "system_credentials", entity_id: systemName, details: { companyDb, keys: creds.map(c => c.key) } });

      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar credenciais");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [credentialsFetch, fetchCredentials]);

  const deleteCredentials = useCallback(async (systemName: string, companyDb?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await credentialsFetch("credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_name: systemName, company_db: companyDb }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      await fetchCredentials(companyDb);

      const { logAuditAction } = await import("@/hooks/useAuditLog");
      await logAuditAction({ action: "delete_credentials", entity_type: "system_credentials", entity_id: systemName, details: { companyDb } });

      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao remover credenciais");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [credentialsFetch, fetchCredentials]);

  const hasCredentials = useCallback((system: string) => {
    return credentials.some(c => c.system_name === system);
  }, [credentials]);

  const fetchCredentialValues = useCallback(
    async (systemName: string, keys: string[], companyDb?: string): Promise<Record<string, string>> => {
      try {
        const params = new URLSearchParams();
        params.set("system", systemName);
        params.set("keys", keys.join(","));
        if (companyDb) params.set("company_db", companyDb);
        const res = await credentialsFetch(`credentials?${params.toString()}`);
        if (!res.ok) return {};
        const data = await res.json();
        const map: Record<string, string> = {};
        for (const row of data.credentials || []) {
          map[row.credential_key] = row.credential_value ?? "";
        }
        return map;
      } catch {
        return {};
      }
    },
    [credentialsFetch]
  );

  return { credentials, isLoading, error, fetchCredentials, saveCredentials, deleteCredentials, hasCredentials, fetchCredentialValues };
}
