import { useCallback, useState } from "react";
import { invokeFn } from "@/lib/invoke-fn";

export interface PoNfRow {
  po_doc_entry?: number | null;
  po_doc_num?: number | null;
  po_date?: string | null;
  po_total?: number | null;
  po_currency?: string | null;
  po_status?: string | null;
  card_code?: string | null;
  card_name?: string | null;
  nf_doc_entry?: number | null;
  nf_doc_num?: number | null;
  nf_date?: string | null;
  nf_total?: number | null;
  mastertax_id?: string | null;
  mastertax_numero?: string | null;
  mastertax_serie?: string | null;
  mastertax_chave?: string | null;
  mastertax_valor?: number | null;
  mastertax_status?: string | null;
  data_emissao?: string | null;
  cnpj_fornecedor?: string | null;
  motivo?: string | null;
}

export interface PoNfResult {
  ok: boolean;
  company_db: string;
  periodo: { inicio: string; fim: string };
  totais: { pedidos: number; nf_sap: number; mastertax: number; a: number; b: number; c: number };
  erp: PoNfRow[];
  ambos: PoNfRow[];
  mastertax: PoNfRow[];
}

export function useAuditPoNf() {
  const [data, setData] = useState<PoNfResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (company_db: string, periodo_inicio: string, periodo_fim: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await invokeFn<PoNfResult & { error?: string }>("audit-cross-po-nf", {
        body: { company_db, periodo_inicio, periodo_fim },
      });
      if (err) throw err;
      if (res?.error) throw new Error(res.error);
      setData(res as PoNfResult);
      return res as PoNfResult;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, run };
}
