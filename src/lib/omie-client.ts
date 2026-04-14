import { authFetch } from "@/lib/auth-fetch";

const FUNCTION_URL = "omie-proxy";

/**
 * Generic helper to call the OMIE API via the omie-proxy edge function.
 */
export async function omieCall<T = unknown>(
  companyDB: string,
  endpoint: string,
  params: Record<string, unknown>,
): Promise<T> {
  const resp = await authFetch(FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "call",
      company_db: companyDB,
      endpoint,
      params,
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json.error || `Erro HTTP ${resp.status}`);
  }
  return json.data as T;
}

/* ── Typed OMIE responses ── */

export interface OmieContaPagar {
  codigo_lancamento_omie: number;
  codigo_cliente_fornecedor: number;
  nome_cliente_fornecedor?: string;
  numero_documento?: string;
  numero_pedido?: string;
  data_vencimento?: string;
  data_emissao?: string;
  data_previsao?: string;
  data_registro?: string;
  valor_documento?: number;
  valor_pago?: number;
  status_titulo?: string;
  codigo_categoria?: string;
  observacao?: string;
  id_conta_corrente?: number;
  numero_documento_fiscal?: string;
  [key: string]: unknown;
}

export interface OmieContaPagarResponse {
  conta_pagar_cadastro?: OmieContaPagar[];
  pagina: number;
  total_de_paginas: number;
  registros: number;
  total_de_registros: number;
}

export interface OmiePedidoCompra {
  cabecalho?: {
    numero_pedido?: string;
    codigo_pedido_integracao?: string;
    data_previsao?: string;
    codigo_cliente_fornecedor?: number;
    [key: string]: unknown;
  };
  infAdic?: {
    dados_adicionais?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Fetch all pages of OMIE contas a pagar.
 * Limits to maxPages to avoid very long loads.
 */
export async function omieListarContasPagar(
  companyDB: string,
  maxPages = 10,
): Promise<OmieContaPagar[]> {
  const all: OmieContaPagar[] = [];
  let page = 1;

  while (page <= maxPages) {
    const res = await omieCall<OmieContaPagarResponse>(
      companyDB,
      "financas/contapagar/",
      {
        call: "ListarContasPagar",
        param: [{
          pagina: page,
          registros_por_pagina: 500,
          apenas_importado_api: "N",
        }],
      },
    );

    const items = res.conta_pagar_cadastro || [];
    all.push(...items);

    if (page >= (res.total_de_paginas || 1)) break;
    page++;
  }

  return all;
}
