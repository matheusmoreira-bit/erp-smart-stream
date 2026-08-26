import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sapQueryAll } from "@/lib/sap-client";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { assertCircuitClosed, recordCircuitFailure, recordCircuitSuccess } from "@/lib/sap-circuit-breaker";
import { useSap } from "@/contexts/SapContext";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { omieListarCategorias, omieListarProdutosServicos } from "@/lib/omie-client";

const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
// Chaves com atualização mais frequente (dados que mudam com frequência no ERP)
const FIVE_MIN_MS = 5 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const CACHE_TTL_OVERRIDES: Record<string, number> = {
  items_purchase_active_v3: FIVE_MIN_MS,
  items_purchase_active_v4: FIVE_MIN_MS,
  items_sales_active_v3: FIVE_MIN_MS,
  items_active_v2: FIVE_MIN_MS,
  omie_categories_expense_v1: FIVE_MIN_MS,
  omie_categories_revenue_v1: FIVE_MIN_MS,
  omie_purchase_products_v1: FIVE_MIN_MS,
  omie_sales_products_v1: FIVE_MIN_MS,
  suppliers_active_v2: FIVE_MIN_MS,
  suppliers_active_v3: FIVE_MIN_MS,
  customers_active_v2: FIVE_MIN_MS,
  // Centros de custo / projetos: ativação-desativação no ERP precisa refletir
  // rápido nos comboboxes (antes ficavam até 7 dias em cache).
  cost_centers: THIRTY_MIN_MS,
  cost_centers_all: THIRTY_MIN_MS,
  projects: THIRTY_MIN_MS,
  projects_all: THIRTY_MIN_MS,
  // Formas de pagamento: sincronizadas por empresa a cada 12h (cron
  // `sap-payment-terms-sync`); o cliente respeita a mesma janela.
  payment_terms_v1: TWELVE_HOURS_MS,
};

const getCacheTtlMs = (key: string) => CACHE_TTL_OVERRIDES[key] ?? DEFAULT_CACHE_TTL_MS;

// -----------------------------------------------------------------------------
// Cache invalidation bus
// -----------------------------------------------------------------------------
// Different parts of the app query the same SAP entity through different cache
// keys (ex.: a tela de Fornecedores usa `suppliers:<db>` enquanto o modal de
// criação de pedidos usa `suppliers_active_v2` / `customers_active_v2`). Quando
// um fornecedor é criado/atualizado, precisamos invalidar TODAS as chaves que
// derivam de BusinessPartners naquele companyDB — senão o usuário vê o BP na
// tela de fornecedores mas não no combobox do pedido.
/**
 * "hard" = o cache foi apagado/expirado: refetch direto no ERP.
 * "soft" = o cache foi reescrito por outro ator: basta reler a linha do banco.
 */
type InvalidationMode = "hard" | "soft";
type Listener = (mode: InvalidationMode) => void;
const listeners = new Map<string, Set<Listener>>();
const listenerKey = (cacheKey: string, companyDb?: string | null) =>
  `${cacheKey}::${companyDb || ""}`;

function subscribe(cacheKey: string, companyDb: string | null | undefined, cb: Listener) {
  const key = listenerKey(cacheKey, companyDb);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(key);
  };
}

/**
 * Invalidate one or more SAP cached lists: deletes the persisted rows in
 * `sap_cache` and forces every mounted `useSapCachedList` with a matching
 * cacheKey/companyDb to refetch from SAP.
 */
export async function invalidateSapCache(
  cacheKeys: string | string[],
  companyDb?: string | null,
) {
  const keys = Array.isArray(cacheKeys) ? cacheKeys : [cacheKeys];
  // Best-effort DB cleanup — errors here shouldn't block the UI signal.
  try {
    let q = supabase.from("sap_cache").delete().in("cache_key", keys);
    if (companyDb) q = q.eq("company_db", companyDb);
    await q;
  } catch (e) {
    console.warn("invalidateSapCache: failed to purge sap_cache rows", e);
  }
  // Fire in-memory listeners so mounted hooks reload immediately.
  for (const k of keys) notifyKey(k, companyDb, "hard");
}

/** Dispara os listeners montados de uma cacheKey (escopo por companyDb). */
function notifyKey(cacheKey: string, companyDb: string | null | undefined, mode: InvalidationMode) {
  const set = listeners.get(listenerKey(cacheKey, companyDb));
  if (set) for (const cb of set) cb(mode);
  // Também avisa listeners que não escoparam por companyDb (raro).
  if (companyDb) {
    const globalSet = listeners.get(listenerKey(cacheKey, null));
    if (globalSet) for (const cb of globalSet) cb(mode);
  }
}

// -----------------------------------------------------------------------------
// Invalidação automática (Realtime)
// -----------------------------------------------------------------------------
// Quando o cache do ERP é atualizado ou limpo por OUTRO ator — outra aba, outro
// usuário ou uma edge function após uma escrita no SAP (criação de fornecedor,
// item, etc.) — as telas abertas precisam saber disso sem depender do TTL.
// Escutamos as mudanças da tabela `sap_cache` via Realtime e re-carregamos
// apenas as listas afetadas (cacheKey + company_db).
let realtimeStarted = false;
// Ecos das próprias escritas deste cliente: ignoramos por alguns segundos para
// não gerar refetch redundante logo após um upsert local.
const selfWrites = new Map<string, number>();
const SELF_ECHO_MS = 5000;

export function markSelfCacheWrite(cacheKey: string, companyDb?: string | null) {
  selfWrites.set(listenerKey(cacheKey, companyDb), Date.now());
}

function isSelfEcho(cacheKey: string, companyDb?: string | null) {
  const k = listenerKey(cacheKey, companyDb);
  const at = selfWrites.get(k);
  if (!at) return false;
  if (Date.now() - at > SELF_ECHO_MS) {
    selfWrites.delete(k);
    return false;
  }
  return true;
}

function ensureRealtimeInvalidation() {
  if (realtimeStarted || typeof window === "undefined") return;
  realtimeStarted = true;
  supabase
    .channel("sap-cache-invalidation")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sap_cache" },
      (payload: any) => {
        const rec = (payload?.new ?? payload?.old ?? {}) as {
          cache_key?: string;
          company_db?: string | null;
        };
        const cacheKey = rec?.cache_key;
        if (!cacheKey) return;
        const companyDb = rec?.company_db ?? null;
        if (isSelfEcho(cacheKey, companyDb)) return;
        // DELETE = cache invalidado → refetch no ERP.
        // INSERT/UPDATE = alguém já buscou dados novos → basta reler do banco.
        const mode: InvalidationMode = payload?.eventType === "DELETE" ? "hard" : "soft";
        notifyKey(cacheKey, companyDb, mode);
      },
    )
    .subscribe();
}


// -----------------------------------------------------------------------------
// Entidades que só devem exibir registros ATIVOS (todas as empresas/bases)
// -----------------------------------------------------------------------------
// Centros de custo e projetos desativados no ERP não podem aparecer em nenhum
// combobox do sistema. Como várias telas compartilham a mesma cacheKey
// (`cost_centers` / `projects`), o filtro é aplicado aqui — de forma central —
// tanto na consulta ao ERP quanto nas linhas vindas do cache (que podem ter
// sido gravadas por uma tela que não enviou o $filter).
const ACTIVE_ONLY_ENDPOINTS = new Set(["CostCenters", "ProfitCenters", "Projects"]);

/** "purchase" | "sales" | null, deduzido da cacheKey da lista de itens. */
function itemUsageFromCacheKey(cacheKey?: string): "purchase" | "sales" | null {
  const k = (cacheKey || "").toLowerCase();
  if (k.includes("sales")) return "sales";
  if (k.includes("purchase")) return "purchase";
  return null;
}

function withActiveFilter(
  endpoint: string,
  params?: Record<string, string | number>,
  cacheKey?: string,
): Record<string, string | number> | undefined {
  if (endpoint === "Items") {
    // Itens inválidos/congelados, ativos imobilizados (itFixedAssets) e itens
    // que o ERP não marca como de compra/venda não podem aparecer nos
    // comboboxes de pedidos.
    const next: Record<string, string | number> = { ...(params || {}) };
    const existing = String(next.$filter || "");
    const usage = itemUsageFromCacheKey(cacheKey);
    const guards: string[] = [];
    if (!/Valid|Frozen/.test(existing)) guards.push("Valid eq 'tYES'", "Frozen eq 'tNO'");
    if (!/ItemType/.test(existing)) guards.push("ItemType ne 'itFixedAssets'");
    if (usage === "purchase" && !/PurchaseItem/.test(existing)) guards.push("PurchaseItem eq 'tYES'");
    if (usage === "sales" && !/SalesItem/.test(existing)) guards.push("SalesItem eq 'tYES'");
    if (guards.length) {
      const guard = guards.join(" and ");
      next.$filter = existing ? `(${existing}) and ${guard}` : guard;
    }
    const select = String(next.$select || "");
    if (select) {
      const fields = select.split(",").map((f) => f.trim());
      const wanted = ["Valid", "Frozen", "ItemType"];
      if (usage === "purchase") wanted.push("PurchaseItem");
      if (usage === "sales") wanted.push("SalesItem");
      for (const f of wanted) if (!fields.includes(f)) fields.push(f);
      next.$select = fields.join(",");
    }
    return next;
  }
  if (!ACTIVE_ONLY_ENDPOINTS.has(endpoint)) return params;
  const next: Record<string, string | number> = { ...(params || {}) };
  const existing = String(next.$filter || "");
  if (!existing.includes("Active")) {
    next.$filter = existing ? `(${existing}) and Active eq 'tYES'` : "Active eq 'tYES'";
  }
  const select = String(next.$select || "");
  if (select && !select.split(",").some((f) => f.trim() === "Active")) {
    next.$select = `${select},Active`;
  }
  return next;
}

const isNo = (v: any) => v === undefined || v === null || v === ""
  ? null
  : String(v).toLowerCase() === "tno" || v === false;

function filterActiveRows(endpoint: string, rows: any[], cacheKey?: string): any[] {
  if (endpoint === "Items") {
    const usage = itemUsageFromCacheKey(cacheKey);
    return rows.filter((r: any) => {
      if (isNo(r?.Valid) === true) return false;
      if (isNo(r?.Frozen) === false) return false; // Frozen === tYES
      if (String(r?.ItemType || "") === "itFixedAssets") return false;
      if (usage === "purchase" && isNo(r?.PurchaseItem) === true) return false;
      if (usage === "sales" && isNo(r?.SalesItem) === true) return false;
      return true;
    });
  }
  if (!ACTIVE_ONLY_ENDPOINTS.has(endpoint)) return rows;
  return rows.filter((r: any) => {
    const active = r?.Active;
    // Se o ERP não devolveu o campo, mantém a linha (fallback conservador).
    if (active === undefined || active === null || active === "") return true;
    return String(active).toLowerCase() !== "tno" && active !== false;
  });
}

interface UseSapCachedListParams {

  cacheKey: string;
  endpoint: string;
  params?: Record<string, string | number>;
  mapRow: (row: any) => SapSearchOption;
  enabled?: boolean;
}

export function useSapCachedList({
  cacheKey,
  endpoint,
  params,
  mapRow,
  enabled = true,
}: UseSapCachedListParams) {
  const { session } = useSap();
  const [options, setOptions] = useState<SapSearchOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const loadedRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const mapRowRef = useRef(mapRow);
  mapRowRef.current = mapRow;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const load = useCallback(async (forceRefresh = false) => {
    if (!enabled || (!forceRefresh && loadedRef.current)) return;
    setIsLoading(true);
    loadedRef.current = true;
    // Quando já exibimos dados (cache), uma revalidação vazia/falha NÃO pode
    // apagar a lista da tela — o combobox ficaria "Nenhum resultado".
    let hadRenderedData = false;

    try {
      const companyDB = session?.companyDB;
      // 1. Try Supabase cache first — REQUIRE company_db to avoid leaking
      //    cached data from another company's SAP base.
      if (companyDB) {
        const cacheQuery = supabase
          .from("sap_cache")
          .select("data, expires_at")
          .eq("cache_key", cacheKey)
          .eq("company_db", companyDB)
          .order("updated_at", { ascending: false })
          .limit(1);

        const { data: cached } = await cacheQuery.maybeSingle();

        if (cached) {
          let cachedData = cached.data as any[];
          const isExpired = new Date(cached.expires_at) <= new Date();

          if (cachedData && cachedData.length > 0) {
            if (endpoint === "CostCenters" || endpoint === "ProfitCenters") {
              cachedData = cachedData.filter(
                (r: any) => !String(r?.CenterCode || "").startsWith("Centr_"),
              );
            }
            cachedData = filterActiveRows(endpoint, cachedData, cacheKey);
            setOptions(cachedData.map(mapRowRef.current));
            hadRenderedData = cachedData.length > 0;
            setIsStale(isExpired);

            // Cache válido (ou sem sessão para revalidar): encerra aqui.
            if ((!forceRefresh && !isExpired) || !session) {
              lastLoadedAtRef.current = Date.now();
              setIsLoading(false);
              return;
            }
            // Stale-while-revalidate: a tela já renderiza com o cache antigo e
            // a atualização no ERP (que pode levar dezenas de segundos)
            // acontece em segundo plano, sem travar o combobox.
            setIsLoading(false);
          }
        }
      }


      // 2. Em empresas Omie, `Items` representa o catálogo combinado de
      // produtos e serviços. Normalizamos a resposta para o formato SAP-like
      // consumido pelos comboboxes existentes.
      if (session?.erpType?.toLowerCase() === "omie" && endpoint === "Items" && companyDB) {
        const usage = itemUsageFromCacheKey(cacheKey);
        const catalog = (await omieListarProdutosServicos(companyDB, { forceRefresh }))
          .filter((item) => usage === "purchase" || usage === "sales" ? item.kind === "product" : true);
        const rows = catalog.map((item) => ({
          ItemCode: item.code,
          ItemName: `${item.kind === "product" ? "[Produto]" : "[Serviço]"} ${item.name}`,
          ExternalCode: item.externalCode || null,
          UnitPrice: item.unitPrice ?? null,
          Valid: item.inactive ? "tNO" : "tYES",
          Frozen: item.inactive ? "tYES" : "tNO",
          SalesItem: "tYES",
          PurchaseItem: "tYES",
          ItemType: item.kind === "service" ? "itService" : "itItems",
        }));
        const activeRows = filterActiveRows(endpoint, rows, cacheKey);
        if (activeRows.length > 0) {
          const expiresAt = new Date(Date.now() + getCacheTtlMs(cacheKey)).toISOString();
          markSelfCacheWrite(cacheKey, companyDB);
          await supabase.from("sap_cache").upsert({
            cache_key: cacheKey,
            company_db: companyDB,
            data: activeRows as any,
            expires_at: expiresAt,
          }, { onConflict: "cache_key,company_db" });
        }
        setOptions(activeRows.map(mapRowRef.current));
        setIsStale(false);
        lastLoadedAtRef.current = Date.now();
        return;
      }

      if (
        session?.erpType?.toLowerCase() === "omie" &&
        (endpoint === "CostCenters" || endpoint === "ProfitCenters") &&
        companyDB
      ) {
        const categoryType = cacheKey.includes("revenue") ? "R" : "D";
        const categories = await omieListarCategorias(companyDB, { type: categoryType, forceRefresh });
        const rows = categories.map((category) => ({
          CenterCode: category.codigo,
          CenterName: category.descricao || category.descricao_padrao || category.codigo,
          Active: "tYES",
        }));
        if (rows.length > 0) {
          const expiresAt = new Date(Date.now() + getCacheTtlMs(cacheKey)).toISOString();
          markSelfCacheWrite(cacheKey, companyDB);
          await supabase.from("sap_cache").upsert({
            cache_key: cacheKey,
            company_db: companyDB,
            data: rows as any,
            expires_at: expiresAt,
          }, { onConflict: "cache_key,company_db" });
        }
        setOptions(rows.map(mapRowRef.current));
        setIsStale(false);
        lastLoadedAtRef.current = Date.now();
        return;
      }

      // 3. If no cache hit (or expired/forced) and we have a SAP session, fetch from SAP.
      //    Prefer the server-side Apiuser route (edge function sap-list-service)
      //    so that results are consistent regardless of the currently signed-in
      //    SAP user's authorizations. Fall back to the direct Service Layer call
      //    (via the user session) only when Apiuser is unavailable.
      if (!session || session.erpType !== "sap" || !companyDB) {
        setIsLoading(false);
        return;
      }

      try {
        assertCircuitClosed(companyDB);
      } catch {
        setError(`SAP indisponível para ${companyDB}. Exibindo os dados armazenados.`);
        setIsStale(true);
        return;
      }

      const effectiveParams = withActiveFilter(endpoint, paramsRef.current, cacheKey);
      let rows: any[] | null = null;
      let sapUnavailable = false;
      try {
        const response = await sapFunctionFetch("sap-list-service", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company_db: companyDB, endpoint, params: effectiveParams }),
        });
        const svcData = await response.json().catch(() => null);
        if (!response.ok) throw new Error(svcData?.error || `HTTP ${response.status}`);
        if (svcData?.code === "sap_unavailable") {
          sapUnavailable = true;
          const message = svcData.warning || "Service Layer do SAP indisponível";
          recordCircuitFailure(companyDB, message);
          setError(`Não foi possível atualizar ${cacheKey}. Exibindo os dados armazenados.`);
          setIsStale(true);
          rows = [];
        } else if (svcData?.code === "no_apiuser") {
          rows = null; // fall through to user-session SL below
        } else if (svcData && Array.isArray(svcData.rows)) {
          rows = svcData.rows as any[];
          recordCircuitSuccess(companyDB);
          setError(null);
        }
      } catch (e) {
        console.warn(`[useSapCachedList/${cacheKey}] sap-list-service falhou, usando SL do usuário:`, e);
        rows = null;
      }

      if (rows === null && !sapUnavailable) {
        // Listas carregadas no mount são auxiliares. Sem uma sessão já ativa,
        // não acionamos o broker (e, portanto, não abrimos login ERP). A ação
        // explícita do usuário continuará autenticando sob demanda.
        if (!session.sessionId) {
          rows = [];
        } else {
          try {
            const { data } = await sapQueryAll(session, endpoint, effectiveParams, false);
            rows = data?.value || [];
            setError(null);
          } catch (error) {
            setError(`Não foi possível atualizar ${cacheKey}. Exibindo os dados armazenados.`);
            setIsStale(true);
            throw error;
          }
        }
      }

      rows = rows || [];


      // Filtra centros de custo auto-gerados pelo SAP (prefixo "Centr_")
      if (endpoint === "CostCenters" || endpoint === "ProfitCenters") {
        rows = rows.filter((r: any) => !String(r?.CenterCode || "").startsWith("Centr_"));
      }
      // Remove registros desativados no ERP (CCs/projetos inativos)
      rows = filterActiveRows(endpoint, rows, cacheKey);


      // 4. Only cache non-empty results
      if (rows.length > 0) {
        const expiresAt = new Date(Date.now() + getCacheTtlMs(cacheKey)).toISOString();
        markSelfCacheWrite(cacheKey, companyDB);
        await supabase
          .from("sap_cache")
          .upsert(
            {
              cache_key: cacheKey,
              company_db: companyDB,
              data: rows as any,
              expires_at: expiresAt,
            },
            { onConflict: "cache_key,company_db" }
          );
      }
      lastLoadedAtRef.current = Date.now();

      // Revalidação vazia (ERP indisponível/timeout) não apaga o que já está
      // em tela vindo do cache.
      if (rows.length === 0 && hadRenderedData) {
        console.warn(`[useSapCachedList/${cacheKey}] revalidação vazia — mantendo cache em tela`);
        return;
      }
      setOptions(rows.map(mapRowRef.current));
      setIsStale(false);
    } catch (e) {
      console.error(`Failed to load cached list [${cacheKey}]:`, e);
      setError(`Não foi possível atualizar ${cacheKey}. Exibindo os dados armazenados.`);
      setIsStale(true);
    } finally {
      setIsLoading(false);
    }
  }, [session?.sessionId, session?.companyDB, session?.erpType, enabled, cacheKey, endpoint]);

  // Reset loaded flag when session changes
  useEffect(() => {
    loadedRef.current = false;
  }, [session?.sessionId, session?.companyDB, session?.erpType, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useCallback(() => {
    loadedRef.current = false;
    load(true);
  }, [load]);

  // Invalidação: eventos locais (invalidateSapCache) + Realtime da tabela
  // `sap_cache` (outra aba, outro usuário ou edge function após escrever no SAP).
  useEffect(() => {
    if (!enabled) return;
    ensureRealtimeInvalidation();
    const unsub = subscribe(cacheKey, session?.companyDB, (mode) => {
      loadedRef.current = false;
      // "soft": outro cliente já gravou dados novos — relê do banco (barato).
      // "hard": cache apagado — busca no ERP.
      load(mode === "hard");
    });
    return unsub;
  }, [cacheKey, session?.companyDB, enabled, load]);

  // Revalidação ao voltar para a aba: se os dados em tela já passaram do TTL,
  // busca a versão atual em segundo plano (mantém a tela rápida e atualizada).
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      const age = Date.now() - lastLoadedAtRef.current;
      if (lastLoadedAtRef.current && age > getCacheTtlMs(cacheKey)) {
        loadedRef.current = false;
        void load(true);
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, cacheKey, load]);


  return { options, isLoading, reload, error, isStale };
}
