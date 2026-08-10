import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import type { UserProductivityRow } from "@/hooks/useUserProductivity";

interface FlowProductivityRecord {
  user_email: string | null;
  user_name: string | null;
  department: string | null;
  doc_type: string | null;
  periodo: string | null;
  docs_criados: number | null;
  valor_total: number | string | null;
  docs_cancelados: number | null;
  edicoes_feitas: number | null;
  docs_editados_unicos: number | null;
}

/** Mapeia o doc_type do Flow para os códigos usados nos rótulos da tela. */
const FLOW_DOC_CODE: Record<string, string> = {
  purchase: "F_PC",
  sales: "F_PV",
  internal: "F_INT",
};

const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function computeScore(criados: number, valor: number, edicoes: number, cancelados: number): number {
  return Math.max(0, Math.round(criados * 1 + valor / 10000 - edicoes * 0.3 - cancelados * 1));
}

/**
 * Produtividade gerada dentro do ERP Flow (documentos criados na plataforma),
 * no mesmo formato das linhas vindas do SAP para permitir a visão híbrida.
 */
export function useFlowProductivity(days = 180) {
  const { session } = useSap();
  const [rows, setRows] = useState<UserProductivityRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase.rpc("get_flow_user_productivity", {
          _company_db: session?.companyDB ?? null,
          _days: days > 0 ? days : 180,
        });
        if (signal?.aborted) return;
        if (err) throw err;

        const mapped: UserProductivityRow[] = ((data ?? []) as FlowProductivityRecord[]).map((r) => {
          const criados = toNum(r.docs_criados);
          const valor = toNum(r.valor_total);
          const edicoes = toNum(r.edicoes_feitas);
          const cancelados = toNum(r.docs_cancelados);
          const email = r.user_email || "sem-usuario";
          return {
            system: "flow" as const,
            userCode: email,
            userName: r.user_name || email,
            department: r.department || "Sem grupo (Flow)",
            docType: FLOW_DOC_CODE[String(r.doc_type || "")] || "F_OUT",
            periodo: r.periodo || "Sem data",
            docsCriados: criados,
            valorTotalBRL: valor,
            docsCancelados: cancelados,
            edicoesFeitas: edicoes,
            docsEditadosUnicos: toNum(r.docs_editados_unicos),
            retrabalhoPct: criados > 0 ? ((edicoes + cancelados) / criados) * 100 : 0,
            ticketMedio: criados > 0 ? valor / criados : 0,
            score: computeScore(criados, valor, edicoes, cancelados),
          };
        });
        setRows(mapped);
      } catch (e) {
        if (signal?.aborted) return;
        console.error("useFlowProductivity error:", e);
        setError(e instanceof Error ? e.message : "Erro ao buscar produtividade do ERP Flow");
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [session?.companyDB, days],
  );

  const refresh = useCallback(() => load(), [load]);

  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);

  return { rows, isLoading, error, refresh };
}
