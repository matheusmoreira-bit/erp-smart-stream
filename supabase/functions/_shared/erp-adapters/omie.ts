// Adapter Omie — traduz "Contas a Pagar" baixadas em ContaPagaERP[].
// Usa credenciais em system_credentials (system_name='omie', chaves app_key/app_secret).
// Baseado em https://developer.omie.com.br/service-list/#/Servicos/Financas/ContaPagar
// Mantemos leitura direta (fetch) para evitar duplicar a camada de omie-proxy do front.

import { normalizeCnpj } from "../fiscal-match.ts";
import type { AdapterContext, ContaPagaERP, ErpAdapter } from "./types.ts";

const OMIE_API = "https://app.omie.com.br/api/v1/financas/contapagar/";

async function loadOmieCreds(supabase: any, companyDb: string): Promise<{ app_key: string; app_secret: string } | null> {
  const { data } = await supabase
    .from("system_credentials")
    .select("credential_key, credential_value")
    .eq("system_name", "omie")
    .eq("company_db", companyDb);
  const kv: Record<string, string> = {};
  for (const r of (data || []) as Array<{ credential_key: string; credential_value: string }>) {
    kv[r.credential_key] = r.credential_value ?? "";
  }
  if (!kv.app_key || !kv.app_secret) return null;
  return { app_key: kv.app_key, app_secret: kv.app_secret };
}

function toBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function fromBrDate(br: string | null | undefined): string | null {
  if (!br) return null;
  const [d, m, y] = br.split("/");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

interface OmieContaCadastro {
  codigo_lancamento_omie?: number;
  codigo_lancamento_integracao?: string;
  data_vencimento?: string;
  data_previsao?: string;
  valor_documento?: number;
  numero_documento_fiscal?: string;
  observacao?: string;
  status_titulo?: string; // ABERTO, PAGO, LIQUIDADO
  distr_cnpj_cpf?: string;
  cnpj_cpf?: string;
  nome_fornecedor?: string;
  categoria?: string;
  info?: { nome_fornecedor?: string; cnpj_cpf?: string };
  detalhes?: { cnpj_cpf?: string; nome_fornecedor?: string };
  pagamentos?: Array<{ data_pagamento?: string; valor_pago?: number; forma_pagamento?: string }>;
}

async function omieCall(cred: { app_key: string; app_secret: string }, call: string, param: unknown): Promise<any> {
  const res = await fetch(OMIE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      app_key: cred.app_key,
      app_secret: cred.app_secret,
      param: [param],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.faultstring) {
    throw new Error(`Omie ${call}: ${json?.faultstring || res.status}`);
  }
  return json;
}

async function listarPagos(
  cred: { app_key: string; app_secret: string },
  periodoInicio: string, periodoFim: string,
): Promise<OmieContaCadastro[]> {
  const out: OmieContaCadastro[] = [];
  let pagina = 1;
  const registrosPorPagina = 500;
  for (;;) {
    const resp = await omieCall(cred, "ListarContasPagar", {
      pagina,
      registros_por_pagina: registrosPorPagina,
      apenas_importado_api: "N",
      filtrar_por_status: "LIQUIDADO",
      filtrar_apenas_ausencia_pagamento: "N",
      filtrar_por_data_de: toBrDate(periodoInicio),
      filtrar_por_data_ate: toBrDate(periodoFim),
      filtrar_por_data: "PAGAMENTO",
    });
    const arr: OmieContaCadastro[] = resp?.conta_pagar_cadastro || [];
    out.push(...arr);
    const total = resp?.total_de_paginas || 1;
    if (pagina >= total || arr.length === 0) break;
    pagina += 1;
    if (pagina > 40) break; // guarda-chuva
  }
  return out;
}

function extractSupplier(row: OmieContaCadastro): { cnpj: string; nome: string | null } {
  const cnpj = normalizeCnpj(
    row.cnpj_cpf ||
    row.distr_cnpj_cpf ||
    row.info?.cnpj_cpf ||
    row.detalhes?.cnpj_cpf ||
    "",
  );
  const nome = row.nome_fornecedor || row.info?.nome_fornecedor || row.detalhes?.nome_fornecedor || null;
  return { cnpj, nome };
}

function pickBaixa(row: OmieContaCadastro, periodo_inicio: string, periodo_fim: string): { data: string | null; valor: number; forma: string | null } {
  const baixas = row.pagamentos || [];
  for (const b of baixas) {
    const iso = fromBrDate(b.data_pagamento);
    if (iso && iso >= periodo_inicio && iso <= periodo_fim) {
      return { data: iso, valor: Number(b.valor_pago || 0), forma: b.forma_pagamento || null };
    }
  }
  const last = baixas[baixas.length - 1];
  return {
    data: fromBrDate(last?.data_pagamento) ?? fromBrDate(row.data_vencimento) ?? null,
    valor: Number(last?.valor_pago ?? row.valor_documento ?? 0),
    forma: last?.forma_pagamento || null,
  };
}

export const OmieAdapter: ErpAdapter = {
  erp_origem: "omie",
  async getContasPagas(ctx: AdapterContext): Promise<ContaPagaERP[]> {
    const cred = await loadOmieCreds(ctx.supabase, ctx.company_db);
    if (!cred) return [];
    const rows = await listarPagos(cred, ctx.periodo_inicio, ctx.periodo_fim);
    return rows.map((r) => {
      const sup = extractSupplier(r);
      const baixa = pickBaixa(r, ctx.periodo_inicio, ctx.periodo_fim);
      const id = String(r.codigo_lancamento_omie ?? r.codigo_lancamento_integracao ?? "");
      return {
        erp_origem: "omie",
        empresa_id: ctx.empresa_id,
        company_db: ctx.company_db,
        id_externo: id,
        cnpj_fornecedor: sup.cnpj,
        razao_social_fornecedor: sup.nome,
        valor_pago: baixa.valor,
        data_baixa: baixa.data || ctx.periodo_fim,
        forma_pagamento: baixa.forma,
        referencia: r.numero_documento_fiscal || null,
        link_origem: id ? `https://app.omie.com.br/#financas/contapagar/${id}` : null,
      } as ContaPagaERP;
    }).filter((c) => c.id_externo && c.cnpj_fornecedor);
  },
};
