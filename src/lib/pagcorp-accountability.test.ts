import { describe, expect, it } from "vitest";

import { extractPagCorpAccountability } from "@/lib/pagcorp-accountability";

describe("extractPagCorpAccountability", () => {
  it("normalizes accountability fields from the transaction", () => {
    expect(extractPagCorpAccountability({
      accountabilityId: 42,
      accountabilityDate: "2026-08-25T10:00:00Z",
      accountabilityDescription: "Hospedagem da equipe",
      accountabilityApprovedAt: "2026-08-26T12:00:00Z",
      approvedBy: { name: "Ana Souza" },
      accountabilityStatusDescription: "Aprovado",
    })).toEqual({
      id: 42,
      date: "2026-08-25T10:00:00Z",
      description: "Hospedagem da equipe",
      status: "Aprovado",
      approvedAt: "2026-08-26T12:00:00Z",
      approverName: "Ana Souza",
    });
  });

  it("uses the approved receipt when fields are nested", () => {
    expect(extractPagCorpAccountability({
      receipts: [
        { id: 1, statusId: 2, description: "Rascunho" },
        {
          id: 2,
          statusId: 3,
          statusDescription: "Aprovado",
          createdAt: "2026-08-24T09:00:00Z",
          updatedAt: "2026-08-25T11:30:00Z",
          justification: "Reunião com cliente",
          approval: { user: { displayName: "Bruno Lima" } },
        },
      ],
    })).toEqual({
      id: 2,
      date: "2026-08-24T09:00:00Z",
      description: "Reunião com cliente",
      status: "Aprovado",
      approvedAt: "2026-08-25T11:30:00Z",
      approverName: "Bruno Lima",
    });
  });
});
