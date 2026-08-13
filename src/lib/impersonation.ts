/**
 * Impersonação (admin "atuando como" outro usuário).
 *
 * Regras:
 * - Só pode ser iniciada por admin de backoffice (user_roles = 'admin'),
 *   validado antes de chamar `startImpersonation` (a UI usa `useAuth().isAdmin`,
 *   que consulta o servidor).
 * - Enquanto ativa, os privilégios de admin do Cloud são SUSPENSOS
 *   (`getIsCloudAdmin()` devolve false) — o app resolve permissões, grupos e
 *   visibilidade exatamente como o usuário alvo.
 * - A sessão do ERP passa a ser a do usuário alvo (login real no SAP com a
 *   senha dele), então todas as chamadas ao ERP usam a identidade do alvo.
 * - Toda ação auditada carrega `impersonated_by` (ver `logAuditAction`).
 */

export interface ImpersonationState {
  /** Usuário SAP alvo (ex.: "joao.silva"). */
  targetUser: string;
  /** Nome de exibição do alvo, quando conhecido. */
  targetName?: string;
  /** E-mail do alvo, quando conhecido. */
  targetEmail?: string;
  /** E-mail da conta Google do admin que iniciou. */
  adminEmail: string;
  /** Usuário do ERP do admin antes da impersonação (para voltar sem reload). */
  adminUser?: string;
  /** true quando foi aberta uma sessão real no ERP com a senha do alvo. */
  withPassword?: boolean;
  companyDB: string;
  startedAt: number;
}

const KEY = "erp_impersonation_v1";
export const IMPERSONATION_EVENT = "erp:impersonation-changed";

let cached: ImpersonationState | null | undefined;

export function getImpersonation(): ImpersonationState | null {
  if (cached !== undefined) return cached;
  try {
    const raw = sessionStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as ImpersonationState) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function isImpersonating(): boolean {
  return getImpersonation() !== null;
}

function persist(state: ImpersonationState | null) {
  cached = state;
  try {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(IMPERSONATION_EVENT));
  } catch {
    /* ignore */
  }
}

export function setImpersonation(state: ImpersonationState | null) {
  persist(state);
}

export function clearImpersonation() {
  persist(null);
}

/**
 * Autorização server-side ANTES de iniciar a impersonação. A Edge Function
 * `impersonation-audit` valida no servidor (via JWT + has_role) que quem pede
 * é admin — o cliente não decide isso. Só com `ok: true` o app entra no modo
 * "atuar como". Também deixa o registro de início no audit_log.
 */
export async function authorizeImpersonationStart(payload: {
  target_user: string;
  target_name?: string | null;
  target_email?: string | null;
  company_db?: string | null;
  with_password?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { authFetch } = await import("@/lib/auth-fetch");
    const resp = await authFetch("impersonation-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, event: "start", started_at: new Date().toISOString() }),
    });
    if (resp.ok) return { ok: true };
    let message = "Não foi possível autorizar a impersonação.";
    try {
      const body = await resp.json();
      if (body?.error) message = String(body.error);
    } catch { /* ignore */ }
    return { ok: false, error: message };
  } catch {
    return { ok: false, error: "Falha ao validar permissão de impersonação no servidor." };
  }
}

/**
 * Registro server-side da impersonação (audit_log). A identidade de quem
 * iniciou/encerrou é derivada do JWT dentro da Edge Function — o cliente não
 * consegue forjar o autor. Nunca lança: auditoria não bloqueia o fluxo.
 */
export async function logImpersonationServerSide(payload: {
  event: "start" | "stop";
  target_user: string;
  target_name?: string | null;
  target_email?: string | null;
  company_db?: string | null;
  with_password?: boolean;
  started_at?: string | null;
}): Promise<void> {
  try {
    const { authFetch } = await import("@/lib/auth-fetch");
    await authFetch("impersonation-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* auditoria nunca bloqueia a impersonação */
  }
}
