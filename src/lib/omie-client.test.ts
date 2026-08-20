import { beforeEach, describe, expect, it, vi } from "vitest";

const { publicFunctionFetch } = vi.hoisted(() => ({
  publicFunctionFetch: vi.fn(),
}));

vi.mock("@/lib/auth-fetch", () => ({ publicFunctionFetch }));

import { omieListarClientesFornecedores, omieListarProdutosServicos } from "./omie-client";

describe("omieListarClientesFornecedores", () => {
  beforeEach(() => {
    publicFunctionFetch.mockReset();
  });

  it("loads every page from the shared customer and supplier registry", async () => {
    publicFunctionFetch.mockImplementation(async (_name: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      const page = request.params.param[0].pagina;
      return new Response(JSON.stringify({
        data: {
          pagina: page,
          total_de_paginas: 2,
          registros: 1,
          total_de_registros: 2,
          clientes_cadastro: [{
            codigo_cliente_omie: page,
            razao_social: page === 1 ? "Cliente A" : "Fornecedor B",
          }],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await omieListarClientesFornecedores("OMIE_TEST", { forceRefresh: true });

    expect(result.map((row) => row.razao_social)).toEqual(["Cliente A", "Fornecedor B"]);
    expect(publicFunctionFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(publicFunctionFetch.mock.calls[0][1].body))).toMatchObject({
      action: "call",
      company_db: "OMIE_TEST",
      endpoint: "geral/clientes/",
      params: {
        call: "ListarClientes",
        param: [{ pagina: 1, registros_por_pagina: 500, apenas_importado_api: "N" }],
      },
    });
  });
});

describe("omieListarProdutosServicos", () => {
  beforeEach(() => {
    publicFunctionFetch.mockReset();
  });

  it("combines active products and services in a searchable catalog", async () => {
    publicFunctionFetch.mockImplementation(async (_name: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      const isProductRequest = request.endpoint === "geral/produtos/";
      return new Response(JSON.stringify({
        data: isProductRequest
          ? {
              pagina: 1,
              total_de_paginas: 1,
              produto_servico_cadastro: [{
                codigo_produto: 10,
                codigo: "SKU-10",
                descricao: "Produto A",
                valor_unitario: 25.5,
                inativo: "N",
              }],
            }
          : {
              nPagina: 1,
              nTotPaginas: 1,
              cadastros: [{
                intListar: { nCodServ: 20, cCodIntServ: "SERV-20" },
                cabecalho: { cCodigo: "S20", cDescricao: "Servico B", nPrecoUnit: 80 },
                info: { inativo: "N" },
              }],
            },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await omieListarProdutosServicos("OMIE_CATALOG_TEST", { forceRefresh: true });

    expect(result).toEqual([
      expect.objectContaining({ code: "P:10", name: "Produto A", kind: "product", externalCode: "SKU-10" }),
      expect.objectContaining({ code: "S:20", name: "Servico B", kind: "service", externalCode: "S20" }),
    ]);
    expect(publicFunctionFetch).toHaveBeenCalledTimes(2);
    const requests = publicFunctionFetch.mock.calls.map((call) => JSON.parse(String(call[1].body)));
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "call",
        company_db: "OMIE_CATALOG_TEST",
        endpoint: "geral/produtos/",
        params: expect.objectContaining({ call: "ListarProdutos" }),
      }),
      expect.objectContaining({
        action: "call",
        company_db: "OMIE_CATALOG_TEST",
        endpoint: "servicos/servico/",
        params: expect.objectContaining({ call: "ListarCadastroServico" }),
      }),
    ]));
  });
});
