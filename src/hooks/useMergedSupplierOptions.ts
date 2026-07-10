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

export function useMergedSupplierOptions({ companyDb, isSales = false }: Options) {
  const { session } = useSap();

  // 1) Lista SAP — traz todos, incluindo Frozen, para poder marcá-los.
  const cacheKey = isSales ? "customers_active_v3" : "suppliers_active_v3";
  const cardType = isSales ? "cCustomer" : "cSupplier";
  const {
    options: sapOptions,
    isLoading: sapLoading,
    reload: reloadSap,
  } = useSapCachedList({
    cacheKey,
    endpoint: "BusinessPartners",
    params: {
      $select: "CardCode,CardName,AliasName,FederalTaxID,Currency,Frozen",
      $filter: `CardType eq '${cardType}'`,
    },
    mapRow: (row: any) =>
      ({
        code: row.CardCode,
        name: row.CardName,
        extra: row.FederalTaxID || undefined,
        currency: row.Currency || "",
        frozen: row.Frozen === "tYES",
        syncStatus: "synced",
        details: {
          fantasyName: row.AliasName || undefined,
          taxId: row.FederalTaxID || undefined,
        },
      } as EnrichedSupplierOption),
  });

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
        "id, card_code, card_name, federal_tax_id, currency, sap_sync_status, sap_sync_error, is_active",
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
          void invalidateSapCache([cacheKey], companyDb);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyDb, cacheKey, fetchLocal]);

  // 4) Merge: SAP como source of truth quando `synced`; sobrepõe com locais
  //    não-sincronizados (novos, com erro, ou pendentes).
  const merged = useMemo<EnrichedSupplierOption[]>(() => {
    const byCardCode = new Map<string, EnrichedSupplierOption>();
    for (const o of sapOptions as EnrichedSupplierOption[]) {
      if (o.code) byCardCode.set(o.code, o);
    }

    const localOnly: EnrichedSupplierOption[] = [];
    for (const r of localRows) {
      const status = r.sap_sync_status || "synced";
      const isSynced = status === "synced";
      const existingSap = r.card_code ? byCardCode.get(r.card_code) : null;

      if (existingSap) {
        // Já veio do SAP — apenas anexa o id local para permitir retry se erro.
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
          extra: r.federal_tax_id || undefined,
          currency: r.currency || "BRL",
          notSynced: true,
          syncStatus: status,
          localId: r.id,
          details: {
            fantasyName: undefined,
            taxId: r.federal_tax_id || undefined,
          },
        });
      }
    }

    const all = [...(sapOptions as EnrichedSupplierOption[]), ...localOnly];
    all.sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
    return all;
  }, [sapOptions, localRows]);

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
    if (companyDb) await invalidateSapCache([cacheKey], companyDb);
    await fetchLocal();
  }, [cacheKey, companyDb, fetchLocal]);

  const activeCount = useMemo(
    () => merged.filter((o) => !o.frozen).length,
    [merged],
  );

  return {
    options: merged,
    isLoading: sapLoading,
    reload: () => {
      reloadSap();
      void fetchLocal();
    },
    crossCompanyLookup,
    retrySync,
    activeCount,
    normalize: normalizeText,
  };
}
