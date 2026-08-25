import { describe, expect, it } from "vitest";

import { buildOmieSalesOrderPayload } from "../../supabase/functions/_shared/omie-sales-order";

describe("buildOmieSalesOrderPayload", () => {
  it("maps an ERP Flow sale to an idempotent Omie sales order", () => {
    const payload = buildOmieSalesOrderPayload({
      id: "a0c7cd55-d3c3-4c51-b171-42bd0aaef189",
      supplier_code: "4111311891",
      due_date: "2026-08-31",
      cost_center: "1.01.02",
      remarks: "Teste de venda",
    }, [{
      item_code: "P:4111317192",
      description: "Licenciamento",
      quantity: 2,
      unit_price: 10.25,
      cost_center: "1.01.03",
    }], 4088381552);

    expect(payload).toMatchObject({
      cabecalho: {
        codigo_cliente: 4111311891,
        codigo_pedido_integracao: "ERPFLOW-SALE-a0c7cd55d3c34c51b17142bd0aaef189",
        data_previsao: "31/08/2026",
        etapa: "10",
        codigo_parcela: "999",
        qtde_parcelas: 1,
      },
      det: [{
        produto: {
          codigo_produto: 4111317192,
          quantidade: 2,
          valor_unitario: 10.25,
        },
        inf_adic: { codigo_categoria_item: "1.01.03" },
      }],
      informacoes_adicionais: {
        codigo_categoria: "1.01.02",
        codigo_conta_corrente: 4088381552,
      },
      lista_parcelas: {
        parcela: [{ percentual: 100, valor: 20.5 }],
      },
    });
  });

  it("rejects service identifiers in the product sales flow", () => {
    expect(() => buildOmieSalesOrderPayload({
      id: "sale-1",
      supplier_code: "123",
      due_date: "2026-08-31",
      cost_center: "1.01",
    }, [{
      item_code: "S:456",
      quantity: 1,
      unit_price: 100,
    }], 789)).toThrow("Ordem de Serviço");
  });
});
