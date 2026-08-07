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
