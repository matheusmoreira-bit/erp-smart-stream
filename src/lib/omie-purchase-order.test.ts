import { describe, expect, it } from "vitest";

import { buildOmiePurchaseOrderPayload } from "../../supabase/functions/_shared/omie-purchase-order";

describe("buildOmiePurchaseOrderPayload", () => {
  it("maps the ERP Flow purchase fields to the official Omie payload", () => {
    const payload = buildOmiePurchaseOrderPayload({
      id: "cf0df4f6-0e8c-4662-a792-d6febd1ee11c",
      supplier_code: "123456789",
      due_date: "2026-08-25",
      cost_center: "2.01.02",
      remarks: "Pedido gerado via integração API",
    }, [{
      item_code: "P:987654321",
      description: "Produto de teste",
      quantity: 10,
      unit_price: 50,
      cost_center: "2.01.03",
    }]);

    expect(payload).toMatchObject({
      cabecalho_incluir: {
        cCodIntPed: "ERPFLOW-cf0df4f60e8c",
        dDtPrevisao: "25/08/2026",
        nCodFor: 123456789,
        cCodCateg: "2.01.02",
        cObs: "Pedido gerado via integração API",
        cObsInt: "ERP Flow cf0df4f6-0e8c-4662-a792-d6febd1ee11c",
      },
      produtos_incluir: [{
        nCodProd: 987654321,
        nQtde: 10,
        nValUnit: 50,
        cCodCateg: "2.01.03",
        cObs: "Produto de teste",
      }],
    });
  });

  it("does not send a service identifier as a purchase product", () => {
    expect(() => buildOmiePurchaseOrderPayload({
      id: "expense-1",
      supplier_code: "123",
      due_date: "2026-08-25",
      cost_center: "2.01",
    }, [{
      item_code: "S:456",
      quantity: 1,
      unit_price: 100,
    }])).toThrow("serviços não podem ser enviados como produto");
  });
});
