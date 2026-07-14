// Modelo normalizado que TODOS os adapters de ERP devem retornar.
// O motor de cruzamento fiscal só conhece este tipo — nunca o formato bruto do ERP.

export interface ContaPagaERP {
  erp_origem: string;                     // 'omie' | 'sap_b1' | outro identificador registrado
  empresa_id: string;                     // uuid de public.companies
  company_db: string;                     // company_db canônico
  id_externo: string;                     // ID do lançamento no ERP de origem
  cnpj_fornecedor: string;                // só dígitos
  razao_social_fornecedor: string | null;
  valor_pago: number;
  data_baixa: string;                     // YYYY-MM-DD
  forma_pagamento?: string | null;
  referencia?: string | null;             // nº nota se o ERP guardar
  link_origem?: string | null;            // deep-link para o lançamento
}

export interface AdapterContext {
  supabase: any;                          // client service-role
  empresa_id: string;
  company_db: string;
  periodo_inicio: string;                 // YYYY-MM-DD
  periodo_fim: string;                    // YYYY-MM-DD
}

export interface ErpAdapter {
  erp_origem: string;
  getContasPagas(ctx: AdapterContext): Promise<ContaPagaERP[]>;
}
