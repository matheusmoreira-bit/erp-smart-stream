// Hook que consolida a lista de fornecedores para o combobox do modal de
// "Nova Compra":
//
//   • Lista base vem do SAP (via useSapCachedList) — inclui inativos, com
//     marcador `frozen`.
//   • Merge com public.suppliers da empresa atual, capturando linhas com
//     sap_sync_status ≠ 'synced' — fornecedores que existem localmente mas
//     nunca chegaram ao SAP são exibidos com o flag `notSynced`.
//   • Realtime: assina INSERT/UPDATE/DELETE em public.suppliers na empresa
//     atual e invalida o cache SAP correspondente para o combobox se atualizar
//     em tempo real (útil quando outro usuário cadastra um fornecedor com o
//     modal já aberto).
//   • Exponibiliza `crossCompanyLookup` para consultar public.suppliers em
//     TODAS as empresas — usado no empty state para dizer "existe na Empresa X".

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSapCachedList, invalidateSapCache } from "@/hooks/useSapCachedList";
import { useSap } from "@/contexts/SapContext";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { normalizeText, onlyDigits } from "@/lib/supplier-search";

export interface EnrichedSupplierOption extends SapSearchOption {
  /** Congelado no SAP (Frozen='tYES') — pode ser selecionado, mas exige reativação. */
  frozen?: boolean;
  /** Existe em public.suppliers mas nunca sincronizou com SAP. */
  notSynced?: boolean;
  /** sap_sync_status quando conhecido (pending|error|skipped|synced). */
  syncStatus?: string | null;
  /** id em public.suppliers (para retentativa de sync ou edição). */
  localId?: string | null;
  currency?: string;
}

export interface CrossCompanyMatch {
  companyDb: string;
  companyLabel: string;
  cardCode: string | null;
  cardName: string;
  federalTaxId: string | null;
  syncStatus: string | null;
}

interface Options {
  /** company_db da sessão (empresa selecionada). */
  companyDb: string | null | undefined;
  /** Se true, busca customers em vez de suppliers. */
  isSales?: boolean;
}

/** Cache em memória (por aba) da lista HANA — evita refazer a chamada ao reabrir o modal. */
const hanaMemory = new Map<string, { rows: any[]; at: number }>();
/** Chamadas em voo, para deduplicar requisições simultâneas. */
const hanaInflight = new Map<string, Promise<any>>();

export function useMergedSupplierOptions({ companyDb, isSales = false }: Options) {

  const { session } = useSap();

  // 1) Lista SAP — traz todos, incluindo Frozen, para poder marcá-los.
  //    Se a empresa tiver HanaAPI (Apiuser + use_hana_db != false), preferimos
  //    a view HANA `VW_FORNECEDORES` / `VW_CLIENTES` porque é significativamente
  //    mais rápida (e completa) do que paginar BusinessPartners via Service
  //    Layer. Em caso de falha ou empresa sem HanaAPI, o hook `useSapCachedList`
  //    abaixo faz o fallback natural para BusinessPartners.
  const cacheKey = isSales ? "customers_active_v6" : "suppliers_active_v6";
  const cardType = isSales ? "cCustomer" : "cSupplier";

  const [hanaLoaded, setHanaLoaded] = useState(false);
  const [hanaOptions, setHanaOptions] = useState<EnrichedSupplierOption[] | null>(null);
  const [hanaReloadTick, setHanaReloadTick] = useState(0);

  // Cache persistente da view HANA em public.sap_cache — evita esperar a
  // chamada à edge function (2–10s) toda vez que o formulário abre.
  // Estratégia stale-while-revalidate: pinta o cache na hora e revalida em
  // background, atualizando a lista quando a resposta chegar.
  const hanaCacheKey = isSales ? "customers_hana_v1" : "suppliers_hana_v1";
  const HANA_TTL_MS = 30 * 60 * 1000;

  const mapHanaRows = (rows: any[]): EnrichedSupplierOption[] =>
    rows.map((r) => ({
      code: r.code,
      name: r.name,
      extra: r.extra,
      currency: r.currency || "BRL",
      frozen: !!r.frozen,
      syncStatus: "synced",
      details: {
        fantasyName: r.details?.fantasyName,
        taxId: r.details?.taxId,
      },
    }));

  useEffect(() => {
    let cancelled = false;
    if (!companyDb || isSales) {
      // VW_CLIENTES não existe — para vendas, sempre usamos Service Layer.
      setHanaOptions(null);
      setHanaLoaded(true);
      return;
    }

    const memKey = `${hanaCacheKey}:${companyDb}`;
    const mem = hanaMemory.get(memKey);
    const memFresh = mem && Date.now() - mem.at < HANA_TTL_MS;

    // 0) Cache em memória — reabrir o formulário é instantâneo.
    if (hanaReloadTick === 0 && mem) {
      setHanaOptions(mem.rows.length ? mapHanaRows(mem.rows) : null);
      setHanaLoaded(true);
      if (memFresh) return;
    }

    if (hanaReloadTick > 0 || !mem) setHanaLoaded(false);

    (async () => {
      let servedFromCache = !!mem;
      // 1) Cache persistente (rápido) — só é ignorado em reload explícito.
      if (hanaReloadTick === 0 && !mem) {
        try {
          const { data: cached } = await (supabase as any)
            .from("sap_cache")
            .select("data, expires_at")
            .eq("cache_key", hanaCacheKey)
            .eq("company_db", companyDb)
            .maybeSingle();
          const rows = cached?.data as any[] | undefined;
          if (!cancelled && Array.isArray(rows) && rows.length > 0) {
            setHanaOptions(mapHanaRows(rows));
            setHanaLoaded(true);
            servedFromCache = true;
            const valid = cached?.expires_at && new Date(cached.expires_at) > new Date();
            hanaMemory.set(memKey, { rows, at: valid ? Date.now() : 0 });
            // Cache ainda válido → não revalida agora.
            if (valid) return;
          }
        } catch {
          /* cache é best-effort */
        }
      }

      // 2) Revalida na origem (dedupe de chamadas concorrentes).
      try {
        const force = hanaReloadTick > 0;
        const reqKey = `${memKey}:${force ? "force" : "soft"}`;
        let pending = hanaInflight.get(reqKey);
        if (!pending) {
          pending = supabase.functions
            .invoke("sap-suppliers-hana", { body: { company_db: companyDb, is_sales: isSales, force } })
            .finally(() => hanaInflight.delete(reqKey));
          hanaInflight.set(reqKey, pending);
        }
        const { data, error } = await pending;
        if (cancelled) return;
        if (error) throw error;
        if (data?.error === "hana_unavailable" || !Array.isArray(data?.rows)) {
          hanaMemory.set(memKey, { rows: [], at: Date.now() });
          if (!servedFromCache) setHanaOptions(null);
        } else {
          hanaMemory.set(memKey, { rows: data.rows as any[], at: Date.now() });
          setHanaOptions(mapHanaRows(data.rows as any[]));
        }
      } catch (e) {
        console.warn("[useMergedSupplierOptions] HANA suppliers indisponível, usando Service Layer.", e);
        if (!cancelled && !servedFromCache) setHanaOptions(null);
      } finally {
        if (!cancelled) setHanaLoaded(true);
      }
    })();
    return () => { cancelled = true; };

  }, [companyDb, isSales, hanaReloadTick, hanaCacheKey]);



  const {
    options: sapOptions,
    isLoading: sapLoading,
    reload: reloadSap,
  } = useSapCachedList({
    cacheKey,
    endpoint: "BusinessPartners",
    params: {
      $select: "CardCode,CardName,AliasName,Currency,Frozen",
      $filter: `CardType eq '${cardType}'`,
    },
    // Ativa o fallback via Service Layer assim que sabemos que o HANA não tem
    // dados para esta empresa. Quando já sabemos disso pelo cache em memória,
    // a lista começa a carregar em paralelo, sem esperar o round-trip do HANA.
    enabled:
      (hanaOptions === null || hanaOptions.length === 0) &&
      (hanaLoaded || hanaMemory.get(`${hanaCacheKey}:${companyDb}`)?.rows.length === 0),

    mapRow: (row: any) =>
      ({
        code: row.CardCode,
        name: row.CardName,
        // Sem CNPJ para empresas fora do HanaAPI — só exibimos o documento
        // fiscal quando vem da view VW_FORNECEDORES (coluna "CNPJ / CPF").
        extra: undefined,
        currency: row.Currency || "",
        frozen: row.Frozen === "tYES",
        syncStatus: "synced",
        details: {
          fantasyName: row.AliasName || undefined,
          taxId: undefined,
        },
      } as EnrichedSupplierOption),
  });

  const effectiveSapOptions = hanaOptions && hanaOptions.length > 0
    ? hanaOptions
    : (sapOptions as EnrichedSupplierOption[]);


  // 2) Linhas locais em public.suppliers da empresa atual — inclui fornecedores
  //    que falharam ou ainda não subiram ao SAP.
  const [localRows, setLocalRows] = useState<any[]>([]);

  const fetchLocal = useCallback(async () => {
    if (!companyDb) {
      setLocalRows([]);
      return;
    }
    const { data, error } = await (supabase as any)
      .from("suppliers")
      .select(
        "id, card_code, card_name, federal_tax_id, u_fgr_taxid0, currency, sap_sync_status, sap_sync_error, is_active",
      )
      .eq("company_db", companyDb);
    if (!error) setLocalRows(data || []);
  }, [companyDb]);

  useEffect(() => {
    void fetchLocal();
  }, [fetchLocal]);

  // 3) Realtime: qualquer mudança em suppliers da empresa recarrega a lista
  //    local e invalida o cache SAP (para pegar o BP recém-criado no ciclo
  //    seguinte de reload).
  useEffect(() => {
    if (!companyDb) return;
    const channel = supabase
      .channel(`suppliers-live-${companyDb}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suppliers", filter: `company_db=eq.${companyDb}` },
        () => {
          void fetchLocal();
          void invalidateSapCache([cacheKey, hanaCacheKey], companyDb);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyDb, cacheKey, hanaCacheKey, fetchLocal]);

  // 4) Merge: SAP como source of truth quando `synced`; sobrepõe com locais
  //    não-sincronizados (novos, com erro, ou pendentes).
  const merged = useMemo<EnrichedSupplierOption[]>(() => {
    const byCardCode = new Map<string, EnrichedSupplierOption>();
    for (const o of effectiveSapOptions) {
      if (o.code) byCardCode.set(o.code, o);
    }

    const localOnly: EnrichedSupplierOption[] = [];
    for (const r of localRows) {
      const status = r.sap_sync_status || "synced";
      const isSynced = status === "synced";
      const existingSap = r.card_code ? byCardCode.get(r.card_code) : null;

      if (existingSap) {
        // Já veio do SAP — apenas anexa o id local para permitir retry se erro.
        const localTaxId = r.federal_tax_id || r.u_fgr_taxid0 || undefined;
        if (localTaxId && !existingSap.extra) existingSap.extra = localTaxId;
        if (localTaxId && !existingSap.details?.taxId) {
          existingSap.details = { ...(existingSap.details || {}), taxId: localTaxId };
        }
        existingSap.localId = r.id;
        existingSap.syncStatus = status;
        // Se local marca não sincronizado, sinaliza no badge
        if (!isSynced) existingSap.notSynced = true;
        continue;
      }

      // Não veio do SAP → adiciona como opção local (invisível no SAP).
      if (!isSynced || !r.card_code) {
        localOnly.push({
          code: r.card_code || `LOCAL:${r.id}`,
          name: r.card_name || "(sem nome)",
          extra: r.federal_tax_id || r.u_fgr_taxid0 || undefined,
          currency: r.currency || "BRL",
          notSynced: true,
          syncStatus: status,
          localId: r.id,
          details: {
            fantasyName: undefined,
            taxId: r.federal_tax_id || r.u_fgr_taxid0 || undefined,
          },
        });
      }
    }

    const all = [...effectiveSapOptions, ...localOnly];
    all.sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
    return all;
  }, [effectiveSapOptions, localRows]);


  // 5) Cross-company: procura em public.suppliers de TODAS as empresas
  //    (respeita RLS) casos onde o termo bate por nome ou CNPJ.
  const crossCompanyLookup = useCallback(
    async (query: string): Promise<CrossCompanyMatch[]> => {
      const q = query.trim();
      if (q.length < 3) return [];
      const digits = onlyDigits(q);
      const orClauses: string[] = [`card_name.ilike.%${q}%`];
      if (digits.length >= 3) {
        orClauses.push(`federal_tax_id.ilike.%${digits}%`);
      }
      const { data, error } = await (supabase as any)
        .from("suppliers")
        .select("company_db, card_code, card_name, federal_tax_id, sap_sync_status")
        .or(orClauses.join(","))
        .limit(20);
      if (error || !data) return [];

      // Junta com display_name das empresas
      const dbs = Array.from(new Set(data.map((d: any) => d.company_db).filter(Boolean)));
      const labelMap = new Map<string, string>();
      if (dbs.length > 0) {
        const { data: companies } = await (supabase as any)
          .from("companies")
          .select("company_db, display_name")
          .in("company_db", dbs);
        for (const c of companies || []) labelMap.set(c.company_db, c.display_name || c.company_db);
      }

      return (data as any[])
        .filter((r) => r.company_db && r.company_db !== companyDb)
        .map((r) => ({
          companyDb: r.company_db,
          companyLabel: labelMap.get(r.company_db) || r.company_db,
          cardCode: r.card_code,
          cardName: r.card_name,
          federalTaxId: r.federal_tax_id,
          syncStatus: r.sap_sync_status,
        }));
    },
    [companyDb],
  );

  // 6) Retry de sync para uma linha local com erro
  const retrySync = useCallback(async (_localId: string) => {
    // Não bloqueia o hook — chamador usa `resendSupplierToSap` de useSuppliers
    // se quiser encadear ação. Aqui, só invalida caches para recarregar.
    if (companyDb) await invalidateSapCache([cacheKey, hanaCacheKey], companyDb);
    await fetchLocal();
  }, [cacheKey, hanaCacheKey, companyDb, fetchLocal]);

  const activeCount = useMemo(
    () => merged.filter((o) => !o.frozen).length,
    [merged],
  );

  return {
    options: merged,
    isLoading: sapLoading || (!hanaLoaded && !!companyDb),
    reload: () => {
      if (companyDb) void invalidateSapCache([hanaCacheKey], companyDb);
      setHanaReloadTick((t) => t + 1);
      reloadSap();
      void fetchLocal();
    },
    crossCompanyLookup,
    retrySync,
    activeCount,
    normalize: normalizeText,
  };

}
