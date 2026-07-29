import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type KypAvaliacao = Database["public"]["Tables"]["kyp_avaliacoes"]["Row"];
export type KypProvider = Database["public"]["Tables"]["kyp_providers"]["Row"];
export type KypFornecedor = Database["public"]["Tables"]["kyp_fornecedores"]["Row"];
export type KypCompanyConfig = Database["public"]["Tables"]["empresa_kyp_config"]["Row"];

export interface KypFiltros {
  companyDb: string;
  acao: string;
  status: string;
  from: string;
  to: string;
  busca: string;
}

export function maskDocumento(doc: string | null): string {
  const d = (doc ?? "").replace(/\D+/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  return d ? `${d.slice(0, 3)}***` : "—";
}

export const ACAO_LABEL: Record<string, string> = {
  NOOP: "Nenhuma ação",
  CREATE: "Diligência criada",
  DEACTIVATE: "Fornecedor bloqueado",
  ERRO: "Erro",
};

export function useKypAvaliacoes(filtros: KypFiltros) {
  const [rows, setRows] = useState<KypAvaliacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from("kyp_avaliacoes")
      .select("*")
      .order("executado_em", { ascending: false })
      .limit(500);
    if (filtros.acao !== "todas") q = q.eq("acao", filtros.acao);
    if (filtros.status !== "todos") q = q.eq("sucesso", filtros.status === "sucesso");
    if (filtros.from) q = q.gte("executado_em", `${filtros.from}T00:00:00Z`);
    if (filtros.to) q = q.lte("executado_em", `${filtros.to}T23:59:59Z`);
    if (filtros.companyDb !== "todas") q = q.contains("empresas_afetadas", [filtros.companyDb]);

    const { data, error: err } = await q;
    if (err) setError(err.message);
    setRows((data ?? []) as KypAvaliacao[]);
    setLoading(false);
  }, [filtros.acao, filtros.status, filtros.from, filtros.to, filtros.companyDb]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = filtros.busca.trim().toLowerCase();
    if (!term) return rows;
    const digits = term.replace(/\D+/g, "");
    return rows.filter((r) =>
      (r.nome ?? "").toLowerCase().includes(term) ||
      (digits ? (r.documento ?? "").includes(digits) : false)
    );
  }, [rows, filtros.busca]);

  return { rows: filtered, loading, error, reload: load };
}

export function useKypConfig() {
  const [providers, setProviders] = useState<KypProvider[]>([]);
  const [configs, setConfigs] = useState<KypCompanyConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("kyp_providers").select("*").order("nome"),
      supabase.from("empresa_kyp_config").select("*"),
    ]);
    setProviders((p ?? []) as KypProvider[]);
    setConfigs((c ?? []) as KypCompanyConfig[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const salvar = useCallback(
    async (companyId: string, patch: { kyp_provider_id?: string; ativo?: boolean; config?: Record<string, unknown> }) => {
      const existing = configs.find((c) => c.company_id === companyId);
      const providerId = patch.kyp_provider_id ?? existing?.kyp_provider_id ??
        providers.find((p) => p.code === "BECOMPLIANCE")?.id;
      if (!providerId) throw new Error("Nenhum provedor de KYP disponível");
      const { error } = await supabase.from("empresa_kyp_config").upsert({
        company_id: companyId,
        kyp_provider_id: providerId,
        ativo: patch.ativo ?? existing?.ativo ?? true,
        config: (patch.config ?? existing?.config ?? {}) as never,
      });
      if (error) throw error;
      await load();
    },
    [configs, providers, load],
  );

  return { providers, configs, loading, salvar, reload: load };
}

export async function reprocessarKyp(documento: string) {
  const { data, error } = await supabase.functions.invoke("kyp-orchestrator", {
    body: { mode: "single", documento },
  });
  if (error) throw error;
  return data;
}
