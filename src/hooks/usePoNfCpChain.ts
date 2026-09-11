import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PoNfCpLink {
  id: string;
  company_db: string;
  id_pedido_compra: string | null;
  id_nf_entrada: string | null;
  numero_nota_fiscal: string | null;
  id_contas_pagar: string | null;
  cod_fornecedor: string | null;
  nome_fornecedor: string | null;
  valor: number | null;
  referencia_valor: string | null;
  status_geral: string | null;
  synced_at: string | null;
}

const SELECT =
  "id,company_db,id_pedido_compra,id_nf_entrada,numero_nota_fiscal,id_contas_pagar,cod_fornecedor,nome_fornecedor,valor,referencia_valor,status_geral,synced_at";

/** Elos Pedido de Compra -> NF de Entrada -> Contas a Pagar de um pedido específico. */
export function usePoNfCpChain(companyDb: string | null | undefined, poDocEntry: number | string | null | undefined) {
  const [links, setLinks] = useState<PoNfCpLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyDb || poDocEntry === null || poDocEntry === undefined || poDocEntry === "") {
      setLinks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("sap_po_nf_cp_cache")
        .select(SELECT)
        .eq("company_db", companyDb)
        .eq("id_pedido_compra", String(poDocEntry))
        .order("id_contas_pagar", { ascending: true });
      if (err) throw err;
      setLinks((data ?? []) as unknown as PoNfCpLink[]);
    } catch (e) {
      setError((e as Error).message);
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [companyDb, poDocEntry]);

  useEffect(() => { void load(); }, [load]);

  return { links, loading, error, reload: load };
}

/** Mapa de elos por ID de pedido de compra, para listas/quadros. */
export function usePoNfCpLinksByPo(companyDb: string | null | undefined, poIds: Array<number | string | null | undefined>) {
  const key = useMemo(
    () => Array.from(new Set(poIds.filter((v) => v !== null && v !== undefined && v !== "").map(String))).sort().join(","),
    [poIds],
  );
  const [map, setMap] = useState<Record<string, PoNfCpLink[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    if (!companyDb || ids.length === 0) {
      setMap({});
      return;
    }
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("sap_po_nf_cp_cache")
        .select(SELECT)
        .eq("company_db", companyDb)
        .in("id_pedido_compra", ids.slice(0, 500));
      if (cancelled) return;
      if (error) {
        setMap({});
      } else {
        const next: Record<string, PoNfCpLink[]> = {};
        for (const row of (data ?? []) as unknown as PoNfCpLink[]) {
          const k = row.id_pedido_compra ?? "";
          if (!k) continue;
          (next[k] ||= []).push(row);
        }
        setMap(next);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyDb, key]);

  return { map, loading };
}
