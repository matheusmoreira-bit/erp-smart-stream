import { requesterMatchesApprover, type ApprovalLevel } from "./approval-skip.ts";
import { identityMatches } from "./text-normalize.ts";

export type PriorApproval = {
  approver_name?: string | null;
  approver_email?: string | null;
  substituted_for_name?: string | null;
  substituted_for_email?: string | null;
};

export type ApprovalLogRow = PriorApproval & {
  decision?: string | null;
  created_at?: string | null;
  remarks?: string | null;
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
  const segmentApprovals = approvalsBySegment.get(segmentKey) || [];
  return [...documentApprovals, ...segmentApprovals];
}

/**
 * Retorna as decisões válidas da revisão atual. Reprocessar regras não cria
 * uma nova submissão e preserva as aprovações; editar, submeter novamente ou
 * reativar o documento cria uma revisão e invalida decisões anteriores.
 */
export function activeRevisionApprovalsFromLogs(logs: ApprovalLogRow[]): PriorApproval[] {
  const revisionDecisions = new Set(["created", "submitted", "reactivated"]);
  let revisionStart = -1;
  logs.forEach((row, index) => {
    const editedRevision = String(row.remarks || "").toLowerCase()
      .includes("atualização da versão anterior");
    if (revisionDecisions.has(String(row.decision || "")) || editedRevision) {
      revisionStart = index;
    }
  });

  return logs
    .slice(revisionStart + 1)
    .filter((row) => row.decision === "approved")
    .map((row) => ({
      approver_name: row.approver_name,
      approver_email: row.approver_email,
      substituted_for_name: row.substituted_for_name,
      substituted_for_email: row.substituted_for_email,
    }));
}

export function approvalMatchesLevel(approval: PriorApproval, level: ApprovalLevel): boolean {
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

export function approvalsSatisfyLevel(
  approvals: PriorApproval[],
  levels: ApprovalLevel[],
): boolean {
  return approvals.some((approval) =>
    levels.some((level) => approvalMatchesLevel(approval, level))
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

    const alreadyApproved = approvalsSatisfyLevel(priorApprovals, eligible);
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
