import { describe, expect, it } from "vitest";

import {
  compareSnapshots,
  DEFAULT_CONFIG,
  type Snapshot,
  type SnapshotLine,
} from "../../supabase/functions/_shared/audit-pay/engine";

function snapshot(lines: SnapshotLine[]): Snapshot {
  return {
    source: "test",
    document_ref: "doc:1",
    doc_date: "2026-08-26",
    fornecedor_code: "F001",
    fornecedor_name: "Fornecedor",
    valor: 100,
    currency: "BRL",
    cost_center: null,
    project: null,
    solicitante: "solicitante@example.com",
    aprovadores: [],
    bank: null,
    lines,
  };
}

function line(overrides: Partial<SnapshotLine> = {}): SnapshotLine {
  return {
    item_code: "ITEM-1",
    description: "Serviço",
    quantity: 10,
    unit_price: 10,
    line_total: 100,
    cost_center: "CC-1",
    project: "PROJ-1",
    ...overrides,
  };
}

describe("audit-pay structural allocation interpretation", () => {
  it("classifies split lines and allocation changes without reporting item changes", () => {
    const baseline = snapshot([line()]);
    const settlement = snapshot([
      line({ quantity: 4, line_total: 40, cost_center: "CC-1" }),
      line({ quantity: 6, line_total: 60, cost_center: "CC-2", project: "PROJ-2" }),
    ]);

    const { findings } = compareSnapshots(baseline, settlement, DEFAULT_CONFIG);

    expect(findings.some((finding) => finding.finding_type === "alteracao_itens")).toBe(false);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        finding_type: "estrutura_rateio_divergente",
        field_name: "estrutura_rateio",
        delta: 0,
      }),
    ]));
  });

  it("does not flag structure when the allocation is unchanged", () => {
    const baseline = snapshot([line()]);
    const settlement = snapshot([line()]);

    const { findings } = compareSnapshots(baseline, settlement, DEFAULT_CONFIG);

    expect(findings).toHaveLength(0);
  });

  it("keeps quantity differences classified as item changes", () => {
    const baseline = snapshot([line()]);
    const settlement = { ...snapshot([line({ quantity: 9, line_total: 90 })]), valor: 90 };

    const { findings } = compareSnapshots(baseline, settlement, DEFAULT_CONFIG);

    expect(findings.some((finding) => finding.finding_type === "alteracao_itens")).toBe(true);
    expect(findings.some((finding) => finding.finding_type === "estrutura_rateio_divergente")).toBe(false);
  });
});
