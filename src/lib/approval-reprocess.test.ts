import { describe, expect, it } from "vitest";

import {
  priorApprovalsForSegment,
  resolveReprocessedApprovalState,
} from "../../supabase/functions/_shared/approval-reprocess";

const levels = [
  { level_order: 1, approver_name: "Ana Silva", approver_email: "ana.silva@empresa.com" },
  { level_order: 2, approver_name: "Bruno Lima", approver_email: "bruno.lima@empresa.com" },
  { level_order: 3, approver_name: "Carla Souza", approver_email: "carla.souza@empresa.com" },
];

describe("resolveReprocessedApprovalState", () => {
  it("keeps prior approvals and routes to the first pending approver", () => {
    const state = resolveReprocessedApprovalState(
      levels,
      [{ approver_email: "ana.silva@empresa.com" }],
      null,
      null,
    );

    expect(state).toMatchObject({
      status: "pendente",
      current_level: 2,
      current_approver: "Bruno Lima",
      preserved_levels: [1],
    });
  });

  it("recognizes an approval performed by a substitute", () => {
    const state = resolveReprocessedApprovalState(
      levels,
      [{ approver_email: "substituto@empresa.com", substituted_for_email: "ana.silva@empresa.com" }],
      null,
      null,
    );

    expect(state.current_level).toBe(2);
    expect(state.preserved_levels).toEqual([1]);
  });

  it("considers a parallel level satisfied by any eligible approver", () => {
    const state = resolveReprocessedApprovalState(
      [
        { level_order: 1, approver_name: "Ana Silva", approver_email: "ana.silva@empresa.com" },
        { level_order: 1, approver_name: "Aline Reis", approver_email: "aline.reis@empresa.com" },
        levels[1],
      ],
      [{ approver_email: "aline.reis@empresa.com" }],
      null,
      null,
    );

    expect(state.current_level).toBe(2);
    expect(state.preserved_levels).toEqual([1]);
  });

  it("finishes when every approver in the new chain has already approved", () => {
    const state = resolveReprocessedApprovalState(
      levels,
      levels.map((level) => ({ approver_email: level.approver_email })),
      null,
      null,
    );

    expect(state).toMatchObject({
      status: "aprovado",
      current_level: 3,
      current_approver: null,
      preserved_levels: [1, 2, 3],
    });
  });

  it("does not reuse an approval from someone absent from the new rule", () => {
    const state = resolveReprocessedApprovalState(
      levels,
      [{ approver_email: "outra.pessoa@empresa.com" }],
      null,
      null,
    );

    expect(state).toMatchObject({ status: "pendente", current_level: 1, preserved_levels: [] });
  });
});

describe("priorApprovalsForSegment", () => {
  const documentApprovals = [{ approver_email: "global@empresa.com" }];

  it("uses document approvals for legacy flows without segment audit", () => {
    expect(priorApprovalsForSegment(new Map(), "segmento-a", documentApprovals))
      .toBe(documentApprovals);
  });

  it("does not leak an approval from one audited segment into another", () => {
    const segmentApprovals = new Map([
      ["segmento-a", [{ approver_email: "segmento-a@empresa.com" }]],
    ]);

    expect(priorApprovalsForSegment(segmentApprovals, "segmento-b", documentApprovals))
      .toEqual([]);
  });
});
