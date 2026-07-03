// Shared helpers to prevent a requester from being their own approver.
//
// Rule (project-wide, all companies):
//  - When picking the CURRENT approval level, if the level's designated
//    approver matches the requester, SKIP forward to the next level.
//  - If every remaining level matches the requester (including the final
//    level), fall back to a global validator: juliana.gavineli.

export type ApprovalLevel = {
  level_order: number;
  approver_name: string | null;
  approver_email: string | null;
};

export type ResolvedApprover = {
  level_order: number;               // level where the doc should sit
  approver_name: string;
  approver_email: string | null;
  fallback_used: boolean;            // true when we bounced to juliana
};

export const SELF_APPROVAL_FALLBACK = {
  name: "Juliana Gavineli",
  email: "juliana.gavineli@anagaming.com.br",
} as const;

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().trim();
}
function emailPrefix(v: string): string {
  const s = norm(v);
  const i = s.indexOf("@");
  return i > 0 ? s.slice(0, i) : s;
}
function tokenize(s: string): string[] {
  return norm(s).replace(/[._\-@]+/g, " ").split(/\s+/).filter(Boolean);
}

/** True when `requester` and `approver` identify the same person. */
export function requesterMatchesApprover(
  requesterName: string | null,
  requesterEmail: string | null,
  approverName: string | null,
  approverEmail: string | null,
): boolean {
  const rEmail = norm(requesterEmail);
  const aEmail = norm(approverEmail);
  if (rEmail && aEmail) {
    if (rEmail === aEmail) return true;
    const rp = emailPrefix(rEmail);
    const ap = emailPrefix(aEmail);
    if (rp && rp === ap) return true;
  }
  // Prefix-vs-name (SAP userCode as requester, email on approver, etc.)
  const rIdent = rEmail || norm(requesterName);
  if (rIdent && aEmail) {
    if (emailPrefix(rIdent) === emailPrefix(aEmail) && emailPrefix(aEmail).length > 0) return true;
  }
  const aIdent = aEmail || norm(approverName);
  if (aIdent && rEmail) {
    if (emailPrefix(rEmail) === emailPrefix(aIdent) && emailPrefix(aIdent).length > 0) return true;
  }
  // Name-token subset match
  const rTokens = tokenize(requesterName || requesterEmail || "");
  const aTokens = tokenize(approverName || approverEmail || "");
  if (rTokens.length && aTokens.length) {
    const shared = rTokens.filter((t) => aTokens.includes(t));
    if (shared.length >= 2) return true;
    if (shared.length === 1 && (rTokens.length === 1 || aTokens.length === 1)) return true;
  }
  return false;
}

/**
 * Given the ordered approval levels and the requester identity, pick the
 * first level whose approver is NOT the requester. If none qualifies, return
 * the Juliana fallback pinned to the final level.
 */
export function pickApproverSkippingRequester(
  levels: ApprovalLevel[],
  requesterName: string | null,
  requesterEmail: string | null,
  startFrom = 1,
): ResolvedApprover {
  const ordered = [...levels].sort((a, b) => a.level_order - b.level_order);
  for (const lvl of ordered) {
    if (lvl.level_order < startFrom) continue;
    if (!lvl.approver_name && !lvl.approver_email) continue;
    if (!requesterMatchesApprover(requesterName, requesterEmail, lvl.approver_name, lvl.approver_email)) {
      return {
        level_order: lvl.level_order,
        approver_name: lvl.approver_name || "",
        approver_email: lvl.approver_email,
        fallback_used: false,
      };
    }
  }
  const finalLevel = ordered.length > 0 ? ordered[ordered.length - 1].level_order : startFrom;
  return {
    level_order: finalLevel,
    approver_name: SELF_APPROVAL_FALLBACK.name,
    approver_email: SELF_APPROVAL_FALLBACK.email,
    fallback_used: true,
  };
}
