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

function isOmieEmptyListError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return message.includes("nao existem registros para a pagina");
}

interface OmieCallOptions {
  cacheTtlMs?: number;
  forceRefresh?: boolean;
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

  if (!options.forceRefresh && cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const inFlight = options.forceRefresh ? undefined : omieInflightRequests.get(cacheKey);
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const request = (async () => {
    try {
      const resp = await publicFunctionFetch(FUNCTION_URL, {
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

export interface OmieClienteFornecedor {
  codigo_cliente_omie: number;
  codigo_cliente_integracao?: string;
  razao_social?: string;
  nome_fantasia?: string;
  cnpj_cpf?: string;
  email?: string;
  inativo?: "S" | "N" | string;
  tags?: Array<{ tag?: string }>;
  [key: string]: unknown;
}

export interface OmieProduto {
  codigo_produto: number;
  codigo_produto_integracao?: string;
  codigo?: string;
  descricao?: string;
  unidade?: string;
  valor_unitario?: number;
  tipoItem?: string;
  inativo?: "S" | "N" | string;
  [key: string]: unknown;
}

export interface OmieServico {
  intListar?: {
    nCodServ?: number;
    cCodIntServ?: string;
  };
  cabecalho?: {
    cCodigo?: string;
    cDescricao?: string;
    nPrecoUnit?: number;
  };
  descricao?: {
    cDescrCompleta?: string;
  };
  info?: {
    inativo?: "S" | "N" | string;
  };
  [key: string]: unknown;
}

export interface OmieCatalogItem {
  code: string;
  name: string;
  kind: "product" | "service";
  externalCode?: string;
  unitPrice?: number;
  inactive: boolean;
}

interface OmieClientesResponse {
  clientes_cadastro?: OmieClienteFornecedor[];
  pagina: number;
  total_de_paginas: number;
  registros: number;
  total_de_registros: number;
}

interface OmieProdutosResponse {
  produto_servico_cadastro?: OmieProduto[];
  pagina: number;
  total_de_paginas: number;
}

interface OmieServicosResponse {
  cadastros?: OmieServico[];
  nPagina: number;
  nTotPaginas: number;
}

/**
 * Clientes e fornecedores compartilham o mesmo cadastro na Omie.
 * Busca a lista completa para os comboboxes de compras e vendas.
 */
export async function omieListarClientesFornecedores(
  companyDB: string,
  options: { maxPages?: number; forceRefresh?: boolean } = {},
): Promise<OmieClienteFornecedor[]> {
  const all: OmieClienteFornecedor[] = [];
  const maxPages = options.maxPages ?? 20;
  let page = 1;

  while (page <= maxPages) {
    const response = await omieCall<OmieClientesResponse>(
      companyDB,
      "geral/clientes/",
      {
        call: "ListarClientes",
        param: [{
          pagina: page,
          registros_por_pagina: 500,
          apenas_importado_api: "N",
        }],
      },
      { cacheTtlMs: 5 * 60_000, forceRefresh: options.forceRefresh },
    );
    all.push(...(response.clientes_cadastro || []));
    if (page >= (response.total_de_paginas || 1)) break;
    page++;
  }

  return all;
}

async function omieListarProdutos(
  companyDB: string,
  maxPages: number,
  forceRefresh: boolean,
): Promise<OmieCatalogItem[]> {
  const all: OmieCatalogItem[] = [];
  let page = 1;
  while (page <= maxPages) {
    let response: OmieProdutosResponse;
    try {
      response = await omieCall<OmieProdutosResponse>(
        companyDB,
        "geral/produtos/",
        {
          call: "ListarProdutos",
          param: [{
            pagina: page,
            registros_por_pagina: 500,
            apenas_importado_api: "N",
            filtrar_apenas_omiepdv: "N",
          }],
        },
        { cacheTtlMs: 5 * 60_000, forceRefresh },
      );
    } catch (error) {
      if (isOmieEmptyListError(error)) break;
      throw error;
    }
    for (const product of response.produto_servico_cadastro || []) {
      const id = Number(product.codigo_produto);
      const name = String(product.descricao || product.codigo || "").trim();
      if (!Number.isFinite(id) || !name) continue;
      all.push({
        code: `P:${id}`,
        name,
        kind: "product",
        externalCode: product.codigo || product.codigo_produto_integracao,
        unitPrice: Number(product.valor_unitario) || undefined,
        inactive: String(product.inativo || "N").toUpperCase() === "S",
      });
    }
    if (page >= (response.total_de_paginas || 1)) break;
    page++;
  }
  return all;
}

async function omieListarServicos(
  companyDB: string,
  maxPages: number,
  forceRefresh: boolean,
): Promise<OmieCatalogItem[]> {
  const all: OmieCatalogItem[] = [];
  let page = 1;
  while (page <= maxPages) {
    let response: OmieServicosResponse;
    try {
      response = await omieCall<OmieServicosResponse>(
        companyDB,
        "servicos/servico/",
        {
          call: "ListarCadastroServico",
          param: [{ nPagina: page, nRegPorPagina: 500 }],
        },
        { cacheTtlMs: 5 * 60_000, forceRefresh },
      );
    } catch (error) {
      if (isOmieEmptyListError(error)) break;
      throw error;
    }
    for (const service of response.cadastros || []) {
      const id = Number(service.intListar?.nCodServ);
      const name = String(service.cabecalho?.cDescricao || service.descricao?.cDescrCompleta || "").trim();
      if (!Number.isFinite(id) || !name) continue;
      all.push({
        code: `S:${id}`,
        name,
        kind: "service",
        externalCode: service.cabecalho?.cCodigo || service.intListar?.cCodIntServ,
        unitPrice: Number(service.cabecalho?.nPrecoUnit) || undefined,
        inactive: String(service.info?.inativo || "N").toUpperCase() === "S",
      });
    }
    if (page >= (response.nTotPaginas || 1)) break;
    page++;
  }
  return all;
}

/** Lista unificada usada nos seletores de produtos e serviços do ERP Flow. */
export async function omieListarProdutosServicos(
  companyDB: string,
  options: { maxPages?: number; forceRefresh?: boolean } = {},
): Promise<OmieCatalogItem[]> {
  const maxPages = options.maxPages ?? 20;
  const forceRefresh = options.forceRefresh ?? false;
  const [products, services] = await Promise.all([
    omieListarProdutos(companyDB, maxPages, forceRefresh),
    omieListarServicos(companyDB, maxPages, forceRefresh),
  ]);
  return [...products, ...services].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
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
