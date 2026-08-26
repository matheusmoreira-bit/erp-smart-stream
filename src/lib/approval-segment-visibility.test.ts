import { describe, expect, it } from "vitest";
import {
  approvalSegmentBelongsToAliases,
  scopeApprovalDocumentToSegments,
} from "../../supabase/functions/_shared/approval-segment-visibility";

const segments = [
  {
    id: "casino",
    segment_key: "1.7.1.2||cassino",
    cost_center: "1.7.1.2",
    project: "CASSINO",
    amount: 63_037.05,
    rule_id: "risk-cassino",
    status: "pendente",
    current_approver: "Gustavo Coelho",
    current_approver_email: "gustavo@empresa.com",
    chain: [{ approver_email: "graciela@empresa.com" }, { approver_email: "gustavo@empresa.com" }],
  },
  {
    id: "vera",
    segment_key: "1.7.1.2||vera",
    cost_center: "1.7.1.2",
    project: "VERA",
    amount: 57_631.47,
    rule_id: "risk-vera",
    status: "pendente",
    current_approver: "Gustavo Coelho",
    current_approver_email: "gustavo@empresa.com",
    chain: [{ approver_email: "graciela@empresa.com" }, { approver_email: "gustavo@empresa.com" }],
  },
  {
    id: "7k",
    segment_key: "1.7.1.2||7k",
    cost_center: "1.7.1.2",
    project: "7K",
    amount: 97_509.57,
    rule_id: "risk-7k",
    status: "aprovado",
    current_approver: "Talita Lacerda",
    current_approver_email: "talita@empresa.com",
    chain: [{ approver_email: "talita@empresa.com" }],
  },
];

const document = {
  id: "expense-1",
  total_amount: 218_178.09,
  cost_center: "1.7.1.2",
  project: "7K",
  current_approver: "Gustavo Coelho / Talita Lacerda",
  level_approvers: [
    { name: "Gustavo Coelho", email: "gustavo@empresa.com" },
    { name: "Talita Lacerda", email: "talita@empresa.com" },
  ],
  items: [
    { id: "i1", description: "Detalhe Cassino", cost_center: "1.7.1.2", project: "CASSINO", line_total: 63_037.05 },
    { id: "i2", description: "Detalhe Vera", cost_center: "1.7.1.2", project: "VERA", line_total: 57_631.47 },
    { id: "i3", description: "SEGREDO 7K", cost_center: "1.7.1.2", project: "7K", line_total: 97_509.57 },
  ],
};

describe("scopeApprovalDocumentToSegments", () => {
  it("reconhece o aprovador em qualquer nivel da cadeia, mesmo fora do nivel atual", () => {
    const belongs = approvalSegmentBelongsToAliases(
      { ...segments[0], current_approver: "Graciela", current_approver_email: "graciela@empresa.com" },
      ["gustavo"],
      (candidate, alias) => String(candidate).toLowerCase().includes(alias),
    );
    expect(belongs).toBe(true);
  });

  it("soma somente as ramificacoes do aprovador e remove os detalhes das demais", () => {
    const scoped = scopeApprovalDocumentToSegments(
      document,
      segments,
      (segment) => String(segment.current_approver_email).startsWith("gustavo@"),
    );

    expect(scoped.total_amount).toBeCloseTo(120_668.52, 2);
    expect(scoped.items).toHaveLength(2);
    expect(scoped.items?.map((item) => item.project)).toEqual(["CASSINO", "VERA"]);
    expect(scoped.approval_segments).toHaveLength(2);
    expect(scoped.restricted_segment_count).toBe(1);
    expect(scoped.restricted_item_count).toBe(1);
    expect(scoped.viewer_segmented).toBe(true);
    expect(JSON.stringify(scoped)).not.toContain("SEGREDO 7K");
    expect(JSON.stringify(scoped)).not.toContain("talita@empresa.com");
  });

  it("mantem a soma de todas as ramificacoes quando o aprovador participa de todas", () => {
    const scoped = scopeApprovalDocumentToSegments(document, segments, () => true);
    expect(scoped.total_amount).toBe(218_178.09);
    expect(scoped.items).toHaveLength(3);
    expect(scoped.viewer_segmented).toBeUndefined();
  });

  it("nao restringe a visao do solicitante que nao participa de nenhuma cadeia", () => {
    const scoped = scopeApprovalDocumentToSegments(document, segments, () => false);
    expect(scoped.total_amount).toBe(218_178.09);
    expect(scoped.items).toHaveLength(3);
  });

  it("mantem a visao integral para a trilha de reembolso", () => {
    const reimbursement = { ...segments[0], id: "reembolso", segment_key: "__reembolso__" };
    const scoped = scopeApprovalDocumentToSegments(
      document,
      [reimbursement, segments[2]],
      (segment) => segment.segment_key === "__reembolso__",
    );
    expect(scoped.total_amount).toBe(218_178.09);
    expect(scoped.items).toHaveLength(3);
  });
});
