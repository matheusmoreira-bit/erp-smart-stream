import { beforeEach, describe, expect, it, vi } from "vitest";

const { publicFunctionFetch } = vi.hoisted(() => ({
  publicFunctionFetch: vi.fn(),
}));

vi.mock("@/lib/auth-fetch", () => ({ publicFunctionFetch }));

import { omieListarClientesFornecedores } from "./omie-client";

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
