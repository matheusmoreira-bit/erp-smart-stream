import { describe, expect, it } from "vitest";

import { getStatusLabel } from "@/hooks/useExpenses";

describe("getStatusLabel", () => {
  it("preserves the SAP purchase status label", () => {
    expect(getStatusLabel("pc_lancado", false, "sap")).toBe("PC Lançado no SAP");
  });

  it("uses Omie for integrated purchases in Omie companies", () => {
    expect(getStatusLabel("pc_lancado", false, "omie")).toBe("PC Lançado no Omie");
  });

  it("uses the sales document prefix with the current ERP", () => {
    expect(getStatusLabel("pc_lancado", true, "omie")).toBe("PV Lançado no Omie");
  });

  it("describes the current payment stage", () => {
    expect(getStatusLabel("nf_entrada", false, "sap")).toBe("NF de Entrada");
    expect(getStatusLabel("pagamento", false, "sap")).toBe("Pago Parcialmente");
    expect(getStatusLabel("finalizado", false, "sap")).toBe("Baixado/Pago");
  });
});
