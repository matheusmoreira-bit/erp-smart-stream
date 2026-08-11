// Contrato normalizado do módulo de NF de Entrada.
//
// O módulo NUNCA conhece o ERP concreto: ele fala apenas com este contrato.
// SAP B1 é a implementação atual; outros ERPs (Omie, etc.) implementam a mesma
// interface e são registrados em ./index.ts — nenhum outro arquivo muda.

/** Nota capturada pelo MasterTax, já normalizada (não é responsabilidade deste módulo produzi-la). */
export interface NotaCapturada {
  id: string;
  chave: string;
  numero: string | null;
  serie: string | null;
  cnpj_fornecedor: string;          // só dígitos/alfanumérico normalizado
  nome_fornecedor: string | null;
  valor: number;
  data_emissao: string | null;      // YYYY-MM-DD
  itens: NotaItem[];
  impostos: Record<string, unknown> | null;
  anexos: { kind: "xml" | "pdf"; path: string | null }[];
}

export interface NotaItem {
  descricao: string | null;
  codigo: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  cfop: string | null;
  ncm: string | null;
}

export interface PedidoCompraLinha {
  line_num: number;
  item_code: string | null;
  descricao: string | null;
  centro_custo: string | null;
  projeto: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
}

export interface PedidoCompraERP {
  id: string;                        // id interno do documento no ERP
  numero: string | null;             // número visível ao usuário
  is_draft: boolean;
  fornecedor_id: string | null;      // código do parceiro no ERP
  fornecedor_nome: string | null;
  fornecedor_cnpj: string | null;
  valor_total: number | null;
  status: string | null;
  linhas: PedidoCompraLinha[];
}

export type NFEntradaTipo = "rascunho" | "lancada";

export interface NFEntradaERP {
  id: string;
  numero: string | null;
  tipo: NFEntradaTipo;
  pedido_id: string | null;
  valor_total: number | null;
}

export interface AdapterContext {
  supabase: any;                     // client service-role
  company_db: string;
  actor: string;
}

export interface BuscarPedidoCriterio {
  pedido_id?: string;
  fornecedor_cnpj?: string;
  fornecedor_id?: string;
  valor?: number;
  data_referencia?: string;
}

export interface ProvisionarEsbocoPayload {
  pedido_id: string;
  fornecedor_id: string | null;
  chave_nf: string;
  numero_nf?: string | null;
  data_documento?: string | null;
  comentario?: string | null;
  /** de-para já conferido: linha do PC -> quantidade/valor a faturar */
  linhas: { line_num: number; quantidade?: number | null; valor_total?: number | null }[];
}

export interface CriarPedidoPayload {
  fornecedor_id: string;
  data_documento?: string | null;
  comentario?: string | null;
  linhas: {
    item_code?: string | null;
    descricao?: string | null;
    quantidade: number;
    valor_unitario: number;
    centro_custo?: string | null;
    projeto?: string | null;
  }[];
}

export interface ErpWriteResult {
  document_id: string;
  document_type: string;
  numero?: string | null;
}

export interface NfEntradaErpAdapter {
  erp_type: string;
  buscarPedidoCompra(ctx: AdapterContext, criterio: BuscarPedidoCriterio): Promise<PedidoCompraERP[]>;
  /** Leitura real no ERP: aquele PC já tem NF de Entrada lançada? */
  nfEntradaJaLancada(ctx: AdapterContext, pedidoId: string): Promise<NFEntradaERP | null>;
  provisionarEsbocoNFEntrada(ctx: AdapterContext, payload: ProvisionarEsbocoPayload): Promise<ErpWriteResult>;
  criarPedidoCompra(ctx: AdapterContext, payload: CriarPedidoPayload): Promise<ErpWriteResult>;
}
