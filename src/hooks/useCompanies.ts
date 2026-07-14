import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CompanyTargets {
  requisicao: number;
  cotacao: number;
  aprovacao: number;
  pedido_compra: number;
  nf_entrada: number;
  pagamento: number;
  aprovador: number;
}

export const DEFAULT_TARGETS: CompanyTargets = {
  requisicao: 2,
  cotacao: 3,
  aprovacao: 3,
  pedido_compra: 3,
  nf_entrada: 2,
  pagamento: 5,
  aprovador: 1,
};

export interface Company {
  id: string;
  company_db: string;
  display_name: string;
  service_layer_url: string | null;
  is_active: boolean;
  created_at: string;
  targets: CompanyTargets;
  erp_type: string;
  legal_name?: string | null;
  trade_name?: string | null;
  tax_id?: string | null;
  foreign_name?: string | null;
  is_foreign?: boolean;
  is_test?: boolean;
  default_currency?: string | null;
}

// -----------------------------------------------------------------------------
// Cache em memória (por sessão do navegador). Antes cada hook fazia refetch em
// cada mount, gerando ~1.5M chamadas à tabela `companies` (que muda muito
// raramente). Agora carregamos uma única vez e compartilhamos entre todos os
// consumidores via listeners + realtime.
// -----------------------------------------------------------------------------
type Cache = { all: Company[] | null; active: Company[] | null };
const cache: Cache = { all: null, active: null };
let inflight: Promise<void> | null = null;
let realtimeSubscribed = false;
const listeners = new Set<() => void>();

async function loadFromSupabase(): Promise<void> {
  const { data } = await supabase.from("companies").select("*").order("display_name");
  const all = (data || []).map((c: any) => ({
    ...c,
    targets: { ...DEFAULT_TARGETS, ...(c.targets as Record<string, number>) },
    erp_type: c.erp_type || "sap",
  })) as Company[];
  cache.all = all;
  cache.active = all.filter((c) => c.is_active);
  listeners.forEach((cb) => cb());
}

function ensureRealtime() {
  if (realtimeSubscribed) return;
  realtimeSubscribed = true;
  const channel = supabase.channel(`companies-sync-shared`);
  channel
    .on("postgres_changes", { event: "*", schema: "public", table: "companies" }, () => {
      inflight = loadFromSupabase().finally(() => { inflight = null; });
    })
    .subscribe();
}

async function ensureLoaded() {
  if (cache.all) return;
  if (!inflight) inflight = loadFromSupabase().finally(() => { inflight = null; });
  await inflight;
}

export function useCompanies(onlyActive = false) {
  const [companies, setCompanies] = useState<Company[]>(
    () => (onlyActive ? cache.active : cache.all) || [],
  );
  const [loading, setLoading] = useState<boolean>(!cache.all);
  const onlyActiveRef = useRef(onlyActive);
  onlyActiveRef.current = onlyActive;

  const sync = useCallback(() => {
    setCompanies((onlyActiveRef.current ? cache.active : cache.all) || []);
    if (cache.all) setLoading(false);
  }, []);

  const fetchCompanies = useCallback(async () => {
    inflight = loadFromSupabase().finally(() => { inflight = null; });
    await inflight;
    sync();
  }, [sync]);

  useEffect(() => {
    ensureRealtime();
    listeners.add(sync);
    ensureLoaded().then(sync);
    return () => { listeners.delete(sync); };
  }, [sync]);

  const getLabel = useCallback(
    (companyDb: string) => companies.find((c) => c.company_db === companyDb)?.display_name || companyDb,
    [companies],
  );

  return { companies, loading, fetchCompanies, getLabel };
}
