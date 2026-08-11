// Regra global de auto-aprovação (frontend).
//
// Quando o solicitante de um documento também é aprovador da alçada, a
// aprovação dele é SEMPRE escalada: ele não é considerado aprovador do nível
// e não deve ver os botões de aprovar/rejeitar. Os demais aprovadores do
// mesmo nível (ou do próximo) seguem o fluxo normalmente.
//
// Espelha `supabase/functions/_shared/approval-skip.ts`.

import { emailLocalPart, normalizeText, tokenizePerson } from "@/lib/text-normalize";

const norm = (v: unknown) => normalizeText(v);

/** True quando `requester` e `approver` identificam a mesma pessoa. */
export function isSameAsRequester(
  requesterName: string | null | undefined,
  requesterEmail: string | null | undefined,
  approverName: string | null | undefined,
  approverEmail: string | null | undefined,
): boolean {
  const rEmail = norm(requesterEmail);
  const aEmail = norm(approverEmail);
  if (rEmail && aEmail) {
    if (rEmail === aEmail) return true;
    const rp = emailLocalPart(rEmail);
    const ap = emailLocalPart(aEmail);
    if (rp && rp === ap) return true;
  }
  const rIdent = rEmail || norm(requesterName);
  if (rIdent && aEmail && emailLocalPart(aEmail) && emailLocalPart(rIdent) === emailLocalPart(aEmail)) {
    return true;
  }
  const aIdent = aEmail || norm(approverName);
  if (aIdent && rEmail && emailLocalPart(aIdent) && emailLocalPart(rEmail) === emailLocalPart(aIdent)) {
    return true;
  }
  const rTokens = tokenizePerson(requesterName || requesterEmail || "");
  const aTokens = tokenizePerson(approverName || approverEmail || "");
  if (rTokens.length && aTokens.length) {
    const shared = rTokens.filter((t) => aTokens.includes(t));
    if (shared.length >= 2) return true;
    if (shared.length === 1 && (rTokens.length === 1 || aTokens.length === 1)) return true;
  }
  return false;
}

/** Remove do nível os aprovadores que são o próprio solicitante. */
export function excludeRequesterApprovers<T extends { name?: string | null; email?: string | null }>(
  approvers: T[],
  requesterName: string | null | undefined,
  requesterEmail: string | null | undefined,
): T[] {
  return (approvers || []).filter(
    (a) => !isSameAsRequester(requesterName, requesterEmail, a.name ?? null, a.email ?? null),
  );
}
