import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isTestCompanyDb } from "@/lib/test-company";

/** Linha do cache de VW_FIN_ANALISE_FLUXO (HANA). Amarra Esboço → Pedido → NF → CP. */
export interface SapFluxoRow {
  company_db: string;
  flow_key: string;
  data_atualizacao_esboco: string | null;
  solicitante: string | null;
  departamento: string | null;
  centro_custo: string | null;
  marca: string | null;
  descricao: string | null;
  aprovador: string | null;
  data_aprovacao: string | null;
  fornecedor: string | null;
  valor: number | null;
  data_vencimento: string | null;
  data_lancamento: string | null;
  data_pagamento: string | null;
  id_esboco: string | null;
  id_pedido: string | null;
  id_nf: string | null;
  id_cp: string | null;
}

interface Options {
  companyDb?: string;
  from?: Date;
  to?: Date;
  consolidated?: boolean;
  /** Se false, não carrega (evita chamadas em ERPs não-SAP). */
  enabled?: boolean;
}

const PAGE = 1000;

/**
 * Lê o cache de VW_FIN_ANALISE_FLUXO. O cache é populado pela edge function
 * `sap-fluxo-analise-sync` (uma linha por documento do fluxo, chaveado por
 * Esboço/Pedido/NF/CP).
 */
export function useSapFluxoAnalise(opts: Options) {
  const { companyDb, from, to, consolidated, enabled = true } = opts;
  const [rows, setRows] = useState<SapFluxoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) { setRows([]); return; }
    setLoading(true);
    setError(null);
    try {
      const fromIso = from?.toISOString();
      const toIso = to?.toISOString();

      const out: SapFluxoRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        let q = supabase
          .from("sap_fluxo_analise_cache")
          .select(
            "company_db, flow_key, data_atualizacao_esboco, solicitante, departamento, centro_custo, marca, descricao, aprovador, data_aprovacao, fornecedor, valor, data_vencimento, data_lancamento, data_pagamento, id_esboco, id_pedido, id_nf, id_cp",
          )
          .order("data_lancamento", { ascending: true, nullsFirst: false })
          .range(offset, offset + PAGE - 1);
        if (!consolidated && companyDb) q = q.eq("company_db", companyDb);
        // Faixa por data_lancamento; docs sem data_lancamento entram apenas quando não há filtro.
        if (fromIso) q = q.gte("data_lancamento", fromIso);
        if (toIso) q = q.lte("data_lancamento", toIso);
        const { data, error } = await q;
        if (error) throw error;
        const chunk = (data || []) as SapFluxoRow[];
        out.push(...chunk);
        if (chunk.length < PAGE) break;
        if (offset > 500_000) break;
      }
      setRows(out.filter((r) => !isTestCompanyDb(r.company_db)));
    } catch (e: any) {
      console.error("useSapFluxoAnalise load error", e);
      setError(e?.message || "Falha ao carregar fluxo de análise");
    } finally {
      setLoading(false);
    }
  }, [companyDb, from?.getTime(), to?.getTime(), consolidated, enabled]);

  useEffect(() => { load(); }, [load]);

  return { rows, loading, error, refresh: load };
}
