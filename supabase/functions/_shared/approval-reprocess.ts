import { requesterMatchesApprover, type ApprovalLevel } from "./approval-skip.ts";
import { identityMatches } from "./text-normalize.ts";

export type PriorApproval = {
  approver_name?: string | null;
  approver_email?: string | null;
  substituted_for_name?: string | null;
  substituted_for_email?: string | null;
};

export type ReprocessedApprovalState = {
  status: "pendente" | "aprovado";
  current_level: number;
  current_approver: string | null;
  current_approver_email: string | null;
  preserved_levels: number[];
};

export function priorApprovalsForSegment(
  approvalsBySegment: ReadonlyMap<string, PriorApproval[]>,
  segmentKey: string,
  documentApprovals: PriorApproval[],
): PriorApproval[] {
  if (approvalsBySegment.size === 0) return documentApprovals;
  return approvalsBySegment.get(segmentKey) || [];
}

function approvalMatchesLevel(approval: PriorApproval, level: ApprovalLevel): boolean {
  const approvedIdentities = [
    approval.approver_email,
    approval.approver_name,
    approval.substituted_for_email,
    approval.substituted_for_name,
  ].filter(Boolean);
  const levelIdentities = [level.approver_email, level.approver_name].filter(Boolean);

  return approvedIdentities.some((approved) =>
    levelIdentities.some((candidate) => identityMatches(approved, candidate))
  );
}

/**
 * Reposiciona uma cadeia recalculada no primeiro nível ainda não satisfeito.
 * Aprovações anteriores só são reaproveitadas quando a mesma identidade
 * continua presente na nova regra. Em níveis paralelos, uma decisão válida
 * satisfaz o nível inteiro, seguindo a semântica do motor de aprovação.
 */
export function resolveReprocessedApprovalState(
  levels: ApprovalLevel[],
  priorApprovals: PriorApproval[],
  requesterName: string | null,
  requesterEmail: string | null,
): ReprocessedApprovalState {
  const ordered = [...levels].sort((a, b) => a.level_order - b.level_order);
  const distinctLevels = Array.from(new Set(ordered.map((level) => level.level_order)))
    .sort((a, b) => a - b);
  const preservedLevels: number[] = [];

  for (const levelOrder of distinctLevels) {
    const eligible = ordered.filter((level) =>
      level.level_order === levelOrder &&
      (level.approver_name || level.approver_email) &&
      !requesterMatchesApprover(
        requesterName,
        requesterEmail,
        level.approver_name,
        level.approver_email,
      )
    );
    if (eligible.length === 0) continue;

    const alreadyApproved = priorApprovals.some((approval) =>
      eligible.some((level) => approvalMatchesLevel(approval, level))
    );
    if (alreadyApproved) {
      preservedLevels.push(levelOrder);
      continue;
    }

    const next = eligible[0];
    return {
      status: "pendente",
      current_level: levelOrder,
      current_approver: next.approver_name || next.approver_email || null,
      current_approver_email: next.approver_email || null,
      preserved_levels: preservedLevels,
    };
  }

  return {
    status: "aprovado",
    current_level: distinctLevels.at(-1) || 0,
    current_approver: null,
    current_approver_email: null,
    preserved_levels: preservedLevels,
  };
}
