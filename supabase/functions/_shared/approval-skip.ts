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
 * first level whose approver(s) are NOT the requester. Supports MULTIPLE rows
 * per `level_order` (parallel approvers — the first to decide encerra o nível).
 *
 * A level is "skippable" only when EVERY row at that `level_order` matches
 * the requester. If any row differs, the requester can't self-approve there
 * and the level is used.
 */
export function pickApproverSkippingRequester(
  levels: ApprovalLevel[],
  requesterName: string | null,
  requesterEmail: string | null,
  startFrom = 1,
): ResolvedApprover {
  const ordered = [...levels].sort((a, b) => a.level_order - b.level_order);
  const distinct = Array.from(new Set(ordered.map((l) => l.level_order))).sort((a, b) => a - b);

  for (const lo of distinct) {
    if (lo < startFrom) continue;
    const rowsAtLevel = ordered.filter(
      (l) => l.level_order === lo && (l.approver_name || l.approver_email),
    );
    if (rowsAtLevel.length === 0) continue;
    // Prefer the first row whose approver is NOT the requester.
    const notRequester = rowsAtLevel.find(
      (r) => !requesterMatchesApprover(requesterName, requesterEmail, r.approver_name, r.approver_email),
    );
    if (notRequester) {
      return {
        level_order: lo,
        approver_name: notRequester.approver_name || "",
        approver_email: notRequester.approver_email,
        fallback_used: false,
      };
    }
    // All rows at this level are the requester → skip the whole level.
  }
  const finalLevel = distinct.length > 0 ? distinct[distinct.length - 1] : startFrom;
  return {
    level_order: finalLevel,
    approver_name: SELF_APPROVAL_FALLBACK.name,
    approver_email: SELF_APPROVAL_FALLBACK.email,
    fallback_used: true,
  };
}
