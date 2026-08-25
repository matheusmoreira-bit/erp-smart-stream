import { describe, expect, it } from "vitest";

import { consolidatePaymentTerms } from "./intercompany-payment-terms";

describe("consolidatePaymentTerms", () => {
  it("consolidates the same payment term even when SAP assigns different IDs", () => {
    const result = consolidatePaymentTerms([
      {
        company_db: "EMPRESA_A",
        display_name: "Empresa A",
        ok: true,
        data: [{ GroupNumber: 12, PaymentTermsGroupName: "30 dias" }],
      },
      {
        company_db: "EMPRESA_B",
        display_name: "Empresa B",
        ok: true,
        data: [{ GroupNumber: 87, PaymentTermsGroupName: "30 dias" }],
      },
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].presence.get("EMPRESA_A")?.sourceCode).toBe("12");
    expect(result.rows[0].presence.get("EMPRESA_B")?.sourceCode).toBe("87");
  });

  it("matches names ignoring surrounding whitespace and letter case", () => {
    const result = consolidatePaymentTerms([
      {
        company_db: "EMPRESA_A",
        display_name: "Empresa A",
        ok: true,
        data: [{ GroupNumber: 1, PaymentTermsGroupName: "À vista" }],
      },
      {
        company_db: "EMPRESA_B",
        display_name: "Empresa B",
        ok: true,
        data: [{ GroupNumber: 2, PaymentTermsGroupName: "  à VISTA  " }],
      },
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].presence.size).toBe(2);
  });

  it("ignores invalid records and failed companies", () => {
    const result = consolidatePaymentTerms([
      {
        company_db: "EMPRESA_A",
        display_name: "Empresa A",
        ok: true,
        data: [{ GroupNumber: Number.NaN, PaymentTermsGroupName: "Inválida" }],
      },
      { company_db: "EMPRESA_B", display_name: "Empresa B", ok: false },
    ]);

    expect(result.rows).toEqual([]);
    expect(result.companies).toEqual([{ db: "EMPRESA_A", name: "Empresa A" }]);
  });
});
