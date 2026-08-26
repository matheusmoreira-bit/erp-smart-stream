import { describe, expect, it } from "vitest";

import {
  approvalsSatisfyLevel,
  activeRevisionApprovalsFromLogs,
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

  it("keeps a future approval latent until the preceding approver decides", () => {
    const track = [
      { level_order: 1, approver_name: "Anderson", approver_email: "anderson@empresa.com" },
      { level_order: 2, approver_name: "Marco", approver_email: "marco@empresa.com" },
    ];

    expect(resolveReprocessedApprovalState(
      track,
      [{ approver_email: "marco@empresa.com" }],
      null,
      null,
    )).toMatchObject({ status: "pendente", current_level: 1, current_approver: "Anderson" });

    expect(resolveReprocessedApprovalState(
      track,
      [
        { approver_email: "marco@empresa.com" },
        { approver_email: "anderson@empresa.com" },
      ],
      null,
      null,
    )).toMatchObject({ status: "aprovado", preserved_levels: [1, 2] });
  });

  it("never asks prior approvers again at any level of a reprocessed rule", () => {
    const reprocessedRule = [
      { level_order: 1, approver_name: "Ana", approver_email: "ana@empresa.com" },
      { level_order: 2, approver_name: "Novo Aprovador", approver_email: "novo@empresa.com" },
      { level_order: 3, approver_name: "Marco", approver_email: "marco@empresa.com" },
      { level_order: 4, approver_name: "Ana", approver_email: "ana@empresa.com" },
      { level_order: 5, approver_name: "Marco", approver_email: "marco@empresa.com" },
    ];
    const priorApprovals = [
      { approver_email: "ana@empresa.com" },
      { approver_email: "marco@empresa.com" },
    ];

    expect(resolveReprocessedApprovalState(
      reprocessedRule,
      priorApprovals,
      null,
      null,
    )).toMatchObject({
      status: "pendente",
      current_level: 2,
      current_approver: "Novo Aprovador",
      preserved_levels: [1],
    });

    expect(resolveReprocessedApprovalState(
      reprocessedRule,
      [...priorApprovals, { approver_email: "novo@empresa.com" }],
      null,
      null,
    )).toMatchObject({
      status: "aprovado",
      current_approver: null,
      preserved_levels: [1, 2, 3, 4, 5],
    });
  });
});

describe("priorApprovalsForSegment", () => {
  const documentApprovals = [{ approver_email: "global@empresa.com" }];

  it("uses document approvals for legacy flows without segment audit", () => {
    expect(priorApprovalsForSegment(new Map(), "segmento-a", documentApprovals))
      .toEqual(documentApprovals);
  });

  it("reuses a document approval in every segment", () => {
    const segmentApprovals = new Map([
      ["segmento-a", [{ approver_email: "segmento-a@empresa.com" }]],
    ]);

    expect(priorApprovalsForSegment(segmentApprovals, "segmento-b", documentApprovals))
      .toEqual(documentApprovals);
  });

  it("combines document and segment audit identities", () => {
    const segmentApproval = { approver_email: "segmento-a@empresa.com" };
    const segmentApprovals = new Map([["segmento-a", [segmentApproval]]]);

    expect(priorApprovalsForSegment(segmentApprovals, "segmento-a", documentApprovals))
      .toEqual([...documentApprovals, segmentApproval]);
  });

  it("applies prior document approvals even after tracks are replaced", () => {
    const oldTracks = new Map([
      ["trilha-antiga", [{ approver_email: "ana@empresa.com" }]],
    ]);

    expect(priorApprovalsForSegment(
      oldTracks,
      "trilha-nova",
      [{ approver_email: "marco@empresa.com" }],
    )).toEqual([{ approver_email: "marco@empresa.com" }]);
  });
});

describe("activeRevisionApprovalsFromLogs", () => {
  it("keeps one document-wide decision regardless of its original track", () => {
    expect(activeRevisionApprovalsFromLogs([
      { decision: "submitted", approver_email: null },
      { decision: "approved", approver_email: "marco@empresa.com" },
    ])).toEqual([{
      approver_name: undefined,
      approver_email: "marco@empresa.com",
      substituted_for_name: undefined,
      substituted_for_email: undefined,
    }]);
  });

  it("invalidates approvals when an edited document is submitted again", () => {
    expect(activeRevisionApprovalsFromLogs([
      { decision: "approved", approver_email: "antigo@empresa.com" },
      { decision: "submitted" },
      { decision: "approved", approver_email: "atual@empresa.com" },
    ])).toEqual([
      expect.objectContaining({ approver_email: "atual@empresa.com" }),
    ]);
  });

  it("preserves approvals when only the rules are reprocessed", () => {
    expect(activeRevisionApprovalsFromLogs([
      { decision: "submitted" },
      { decision: "approved", approver_email: "aprovador@empresa.com" },
      { decision: "routing_fallback", approver_email: "sistema@empresa.com" },
    ])).toEqual([
      expect.objectContaining({ approver_email: "aprovador@empresa.com" }),
    ]);
  });

  it("invalidates approvals after reactivation into a new editable revision", () => {
    expect(activeRevisionApprovalsFromLogs([
      { decision: "approved", approver_email: "antigo@empresa.com" },
      { decision: "reactivated" },
    ])).toEqual([]);
  });

  it("invalidates old approvals when an edited revision is auto-approved", () => {
    expect(activeRevisionApprovalsFromLogs([
      { decision: "approved", approver_email: "antigo@empresa.com" },
      {
        decision: "approved",
        approver_name: "Sistema",
        remarks: "Atualização da versão anterior (status: aprovado). Documento aprovado automaticamente.",
      },
    ])).toEqual([]);
  });
});

describe("approvalsSatisfyLevel", () => {
  it("satisfies a later occurrence of the same approver", () => {
    expect(approvalsSatisfyLevel(
      [{ approver_email: "marco@empresa.com" }],
      [{ level_order: 3, approver_name: "Marco", approver_email: "marco@empresa.com" }],
    )).toBe(true);
  });

  it("does not satisfy a level assigned to another person", () => {
    expect(approvalsSatisfyLevel(
      [{ approver_email: "marco@empresa.com" }],
      [{ level_order: 2, approver_name: "Anderson", approver_email: "anderson@empresa.com" }],
    )).toBe(false);
  });
});
