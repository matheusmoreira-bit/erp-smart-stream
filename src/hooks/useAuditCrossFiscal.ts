import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CenarioCruzamento = "pago_sem_nota" | "nota_sem_pagamento" | "conciliado";
export type StatusMatch = "automatico" | "ambiguo" | "confirmado_manual" | "ignorado";

export interface CruzamentoRow {
  id: string;
  cenario: CenarioCruzamento;
  empresa_id: string;
  company_db: string;
  erp_origem: string | null;
  cnpj_fornecedor: string;
  razao_social_fornecedor: string | null;
  nota_mastertax_id: string | null;
  nota_chave_acesso: string | null;
  nota_numero: string | null;
  nota_valor: number | null;
  nota_data_emissao: string | null;
  conta_paga_id_externo: string | null;
  conta_paga_valor: number | null;
  conta_paga_data_baixa: string | null;
  conta_paga_forma_pagamento: string | null;
  conta_paga_link_origem: string | null;
  diferenca_valor: number | null;
  diferenca_dias: number | null;
  score_confianca: number | null;
  status_match: StatusMatch;
  observacao_usuario: string | null;
  periodo_inicio: string;
  periodo_fim: string;
  criado_em: string;
}

interface Filters {
  empresa_id?: string;
  erp_origem?: string;
  cenario?: CenarioCruzamento;
  periodo_inicio?: string;
  periodo_fim?: string;
}

export function useAuditCrossFiscal(filters: Filters) {
  const [rows, setRows] = useState<CruzamentoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("auditoria_cruzamento_fiscal" as any)
      .select("*")
      .order("criado_em", { ascending: false })
      .limit(2000);
    if (filters.empresa_id) q = q.eq("empresa_id", filters.empresa_id);
    if (filters.erp_origem) q = q.eq("erp_origem", filters.erp_origem);
    if (filters.cenario) q = q.eq("cenario", filters.cenario);
    if (filters.periodo_inicio) q = q.gte("periodo_inicio", filters.periodo_inicio);
    if (filters.periodo_fim) q = q.lte("periodo_fim", filters.periodo_fim);
    const { data, error: err } = await q;
    if (err) setError(err.message);
    else setRows((data || []) as unknown as CruzamentoRow[]);
    setLoading(false);
  }, [filters.empresa_id, filters.erp_origem, filters.cenario, filters.periodo_inicio, filters.periodo_fim]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const runCross = useCallback(async (empresa_id: string, periodo_inicio: string, periodo_fim: string) => {
    const { data, error: err } = await supabase.functions.invoke("audit-cross-fiscal-run", {
      body: { empresa_id, periodo_inicio, periodo_fim },
    });
    if (err) throw err;
    await fetchRows();
    return data as { ok: boolean; notas_analisadas: number; contas_analisadas: number; linhas_geradas: number };
  }, [fetchRows]);

  const updateRow = useCallback(async (id: string, patch: Partial<CruzamentoRow>) => {
    const { error: err } = await supabase
      .from("auditoria_cruzamento_fiscal" as any)
      .update(patch as any)
      .eq("id", id);
    if (err) throw err;
    await fetchRows();
  }, [fetchRows]);

  return { rows, loading, error, refresh: fetchRows, runCross, updateRow };
}
