import { authFetch } from "@/lib/auth-fetch";

export interface UserSapCredential {
  company_db: string;
  sap_user: string;
  updated_at: string;
}

export function defaultSapUserFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  const local = email.split("@")[0] || "";
  return local.toLowerCase().slice(0, 20);
}

export async function listUserSapCredentials(companyDb?: string): Promise<UserSapCredential[]> {
  const qs = companyDb ? `?company_db=${encodeURIComponent(companyDb)}` : "";
  const res = await authFetch(`sap-user-credentials${qs}`);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.credentials) ? data.credentials : [];
}

export async function saveUserSapCredential(companyDb: string, sapUser: string, sapPassword: string): Promise<void> {
  const res = await authFetch("sap-user-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_db: companyDb, sap_user: sapUser, sap_password: sapPassword }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Erro ${res.status}`);
  }
}

export async function deleteUserSapCredential(companyDb: string): Promise<void> {
  const res = await authFetch("sap-user-credentials", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_db: companyDb }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Erro ${res.status}`);
  }
}

export interface SapAutoLoginResult {
  sessionId: string;
  routeId: string;
  companyDB: string;
  sapUser: string;
  sessionTimeout: number;
  /** true quando a sessão veio do cache do servidor (sem novo /Login). */
  cached?: boolean;
  /** true quando a sessão foi aberta com a credencial de serviço (ApiUser). */
  service?: boolean;
}

/**
 * Resolve a sessão do Service Layer no servidor. O backend reaproveita a
 * sessão em cache (tabela `erp_session_cache`) enquanto ela estiver válida;
 * use `force` para descartar o cache quando o SAP recusar a sessão.
 *
 * `allowService` (padrão: true) permite o fallback para a credencial de
 * serviço (ApiUser) da empresa — usado em fluxos de leitura. Ações que
 * precisam da identidade do próprio usuário devem passar `false`.
 */
export async function sapAutoLogin(
  companyDb: string,
  force = false,
  options?: { allowService?: boolean },
): Promise<SapAutoLoginResult> {
  const res = await authFetch("sap-auto-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_db: companyDb,
      force,
      allow_service: options?.allowService !== false,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data as SapAutoLoginResult;
}


/**
 * Guarda no servidor uma sessão criada pelo login interativo (usuário + senha),
 * para que as próximas integrações — ex.: lotes do PagCorp — reutilizem o
 * mesmo sessionId enquanto ele estiver válido.
 */
export async function cacheSapSession(params: {
  companyDb: string;
  sessionId: string;
  routeId?: string;
  sapUser?: string;
  sessionTimeout?: number;
}): Promise<void> {
  try {
    await authFetch("sap-auto-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_db: params.companyDb,
        store: {
          session_id: params.sessionId,
          route_id: params.routeId || "",
          sap_user: params.sapUser || "",
          session_timeout: params.sessionTimeout || 30,
        },
      }),
    });
  } catch {
    /* cache é otimização — nunca bloqueia a ação do usuário */
  }
}

/** Descarta a sessão em cache no servidor (sessão recusada pelo ERP). */
export async function invalidateSapSessionCache(companyDb: string): Promise<void> {
  try {
    await authFetch("sap-auto-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_db: companyDb, invalidate: true }),
    });
  } catch {
    /* melhor esforço */
  }
}
