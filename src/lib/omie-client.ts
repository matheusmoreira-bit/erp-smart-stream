import { publicFunctionFetch } from "@/lib/auth-fetch";

const FUNCTION_URL = "omie-proxy";
const OMIE_CACHE_TTL_MS = 60_000;

type OmieCacheEntry = {
  data: unknown;
  expiresAt: number;
};

const omieResponseCache = new Map<string, OmieCacheEntry>();
const omieInflightRequests = new Map<string, Promise<unknown>>();

function getOmieCacheKey(
  companyDB: string,
  endpoint: string,
  params: Record<string, unknown>,
) {
  return JSON.stringify([companyDB, endpoint, params]);
}

function isOmieRedundantError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Consumo redundante") ||
    error.message.includes("REDUNDANT")
  );
}

interface OmieCallOptions {
  cacheTtlMs?: number;
}

/**
 * Generic helper to call the OMIE API via the omie-proxy edge function.
 * Deduplicates in-flight requests and reuses recent responses to avoid OMIE redundant-consumption errors.
 */
export async function omieCall<T = unknown>(
  companyDB: string,
  endpoint: string,
  params: Record<string, unknown>,
  options: OmieCallOptions = {},
): Promise<T> {
  const cacheTtlMs = options.cacheTtlMs ?? OMIE_CACHE_TTL_MS;
  const cacheKey = getOmieCacheKey(companyDB, endpoint, params);
  const cached = omieResponseCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const inFlight = omieInflightRequests.get(cacheKey);
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const request = (async () => {
    try {
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

      omieResponseCache.set(cacheKey, {
        data: json.data,
        expiresAt: Date.now() + cacheTtlMs,
      });

      return json.data as T;
    } catch (error) {
      if (cached && isOmieRedundantError(error)) {
        return cached.data as T;
      }
      throw error;
    } finally {
      omieInflightRequests.delete(cacheKey);
    }
  })();

  omieInflightRequests.set(cacheKey, request);
  return request;
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
      { cacheTtlMs: OMIE_CACHE_TTL_MS },
    );

    const items = res.conta_pagar_cadastro || [];
    all.push(...items);

    if (page >= (res.total_de_paginas || 1)) break;
    page++;
  }

  return all;
}
