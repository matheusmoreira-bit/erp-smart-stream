// Edge function: standalone-snapshot
// Copia TODOS os cadastros mestres de uma empresa do SAP para o banco do Flow
// (`public.sap_cache`), com validade longa, para que o sistema opere sem o ERP
// durante o modo standalone.
//
// POST { company_db: string, ttl_days?: number }
// Auth: scheduler/service-role ou administrador Cloud.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as baseCorsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { upsertSapCacheMerged } from "../_shared/sap-list-cache.ts";

const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-company-db",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ListSpec {
  cacheKey: string;
  endpoint: string;
  params?: Record<string, string | number>;
  /** cacheKey depende da empresa (ex.: `suppliers:<db>`) */
  perCompany?: boolean;
  /** substitui o conteúdo do cache em vez de mesclar */
  replace?: boolean;
}

/**
 * Espelha exatamente as consultas feitas pelas telas (`useSapCachedList`),
 * para que o formato das linhas gravadas seja o que os comboboxes esperam.
 */
const SPECS: ListSpec[] = [
  // Fornecedores / clientes
  {
    cacheKey: "suppliers",
    perCompany: true,
    endpoint: "BusinessPartners",
    params: {
      $filter: "CardType eq 'cSupplier'",
      $select:
        "CardCode,CardName,FederalTaxID,UnifiedFederalTaxID,EmailAddress,Phone1,Phone2,Currency,Frozen",
      $orderby: "CardName",
    },
  },
  {
    cacheKey: "suppliers_active_v7",
    endpoint: "BusinessPartners",
    params: {
      $select: "CardCode,CardName,AliasName,FederalTaxID,UnifiedFederalTaxID,Currency,Frozen",
      $filter: "CardType eq 'cSupplier'",
    },
  },
  {
    cacheKey: "customers_active_v7",
    endpoint: "BusinessPartners",
    params: {
      $select: "CardCode,CardName,AliasName,FederalTaxID,UnifiedFederalTaxID,Currency,Frozen",
      $filter: "CardType eq 'cCustomer'",
    },
  },
  {
    cacheKey: "suppliers_active_v2",
    endpoint: "BusinessPartners",
    params: {
      $select: "CardCode,CardName,AliasName,FederalTaxID,Currency",
      $filter: "CardType eq 'cSupplier' and Frozen eq 'tNO'",
    },
  },
  {
    cacheKey: "suppliers_active_v3",
    endpoint: "BusinessPartners",
    params: { $select: "CardCode,CardName", $filter: "CardType eq 'cSupplier' and Frozen ne 'tYES'" },
  },
  {
    cacheKey: "customers_active_v2",
    endpoint: "BusinessPartners",
    params: {
      $select: "CardCode,CardName,AliasName,FederalTaxID,Currency",
      $filter: "CardType eq 'cCustomer' and Frozen eq 'tNO'",
    },
  },
  // Itens
  {
    cacheKey: "items_all",
    perCompany: true,
    endpoint: "Items",
    params: {
      $select: "ItemCode,ItemName,ItemsGroupCode,Valid,Frozen,SalesItem,InventoryItem,PurchaseItem",
      $orderby: "ItemName",
    },
  },
  {
    cacheKey: "items_active_v2",
    endpoint: "Items",
    params: { $filter: "Valid eq 'tYES' and Frozen eq 'tNO'", $select: "ItemCode,ItemName" },
  },
  {
    cacheKey: "items_purchase_active_v3",
    endpoint: "Items",
    params: { $filter: "Valid eq 'tYES' and Frozen eq 'tNO'", $select: "ItemCode,ItemName" },
  },
  {
    cacheKey: "items_purchase_active_v4",
    endpoint: "Items",
    params: { $filter: "Valid eq 'tYES' and Frozen ne 'tYES'", $select: "ItemCode,ItemName" },
  },
  {
    cacheKey: "items_sales_active_v3",
    endpoint: "Items",
    params: {
      $filter: "Valid eq 'tYES' and Frozen eq 'tNO' and SalesItem eq 'tYES'",
      $select: "ItemCode,ItemName",
    },
  },
  {
    cacheKey: "items_sales_only_v1",
    endpoint: "Items",
    params: {
      $filter: "Valid eq 'tYES' and Frozen eq 'tNO' and SalesItem eq 'tYES'",
      $select: "ItemCode,ItemName",
    },
  },
  // Centros de custo / projetos
  {
    cacheKey: "cost_centers",
    endpoint: "ProfitCenters",
    params: { $filter: "Active eq 'tYES'", $select: "CenterCode,CenterName" },
  },
  {
    cacheKey: "cost_centers_all",
    endpoint: "ProfitCenters",
    params: { $select: "CenterCode,CenterName,Active" },
  },
  {
    cacheKey: "projects",
    endpoint: "Projects",
    params: { $filter: "Active eq 'tYES'", $select: "Code,Name" },
  },
  // Demais cadastros usados nos formulários
  {
    cacheKey: "payment_terms_v1",
    endpoint: "PaymentTermsTypes",
    params: { $select: "GroupNumber,PaymentTermsGroupName" },
  },
  { cacheKey: "item_groups", endpoint: "ItemGroups", params: { $select: "Number,GroupName", $orderby: "GroupName" } },
  { cacheKey: "item_groups_v1", endpoint: "ItemGroups", params: { $select: "Number,GroupName" } },
  {
    cacheKey: "chart_of_accounts_active",
    endpoint: "ChartOfAccounts",
    params: { $filter: "ActiveAccount eq 'tYES'", $select: "Code,Name,FormatCode" },
  },
  { cacheKey: "nota_fiscal_usages_v2", endpoint: "NotaFiscalUsage" },
  {
    cacheKey: "sl_users",
    endpoint: "Users",
    params: { $select: "InternalKey,UserCode,UserName,eMail" },
  },
];

async function fetchList(
  companyDb: string,
  spec: ListSpec,
): Promise<{ rows: any[]; error?: string }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/sap-list-service`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      // Permite ler o ERP mesmo com o modo standalone já ligado (recópia).
      "x-standalone-bypass": SERVICE_KEY,
    },
    body: JSON.stringify({
      company_db: companyDb,
      endpoint: spec.endpoint,
      params: spec.params || {},
      page_size: 1000,
    }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) return { rows: [], error: data?.error || `HTTP ${resp.status}` };
  if (data?.code === "no_apiuser") return { rows: [], error: "Apiuser não configurado" };
  if (data?.code === "sap_unavailable") return { rows: [], error: data?.warning || "SAP indisponível" };
  return { rows: Array.isArray(data?.rows) ? data.rows : [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const companyDb = String(body?.company_db || "").trim();
    if (!companyDb || !/^[A-Za-z0-9_\-]+$/.test(companyDb)) {
      return new Response(JSON.stringify({ error: "company_db obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ttlDays = Math.min(Math.max(Number(body?.ttl_days) || 30, 1), 180);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const results: Array<{ cache_key: string; rows: number; status: string; error?: string }> = [];

    for (const spec of SPECS) {
      const cacheKey = spec.perCompany ? `${spec.cacheKey}:${companyDb}` : spec.cacheKey;
      try {
        const { rows, error } = await fetchList(companyDb, spec);
        if (error) {
          results.push({ cache_key: cacheKey, rows: 0, status: "error", error });
          continue;
        }
        if (rows.length === 0) {
          results.push({ cache_key: cacheKey, rows: 0, status: "empty" });
          continue;
        }
        await upsertSapCacheMerged(sb as any, cacheKey, companyDb, rows, expiresAt);
        results.push({ cache_key: cacheKey, rows: rows.length, status: "ok" });
      } catch (e) {
        results.push({ cache_key: cacheKey, rows: 0, status: "error", error: (e as Error).message });
      }
    }

    // Fornecedores/clientes via view HANA (quando a empresa usa HanaAPI).
    for (const isSales of [false, true]) {
      const key = isSales ? "customers_hana_v1" : "suppliers_hana_v1";
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/sap-suppliers-hana`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
            "x-standalone-bypass": SERVICE_KEY,
          },
          body: JSON.stringify({ company_db: companyDb, is_sales: isSales, force: true }),
        });
        const data = await resp.json().catch(() => null);
        const rows = Array.isArray(data?.rows) ? data.rows.length : 0;
        if (rows > 0) {
          // a própria função grava o cache; aqui só estendemos a validade
          await sb
            .from("sap_cache")
            .update({ expires_at: expiresAt })
            .eq("cache_key", key)
            .eq("company_db", companyDb);
          results.push({ cache_key: key, rows, status: "ok" });
        } else {
          results.push({ cache_key: key, rows: 0, status: "empty", error: data?.message || data?.error });
        }
      } catch (e) {
        results.push({ cache_key: key, rows: 0, status: "error", error: (e as Error).message });
      }
    }

    // Prolonga a validade de todo o cache remanescente da empresa, para que
    // nada apareça como "vencido" durante a janela sem ERP.
    await sb
      .from("sap_cache")
      .update({ expires_at: expiresAt })
      .eq("company_db", companyDb)
      .lt("expires_at", expiresAt);

    const okCount = results.filter((r) => r.status === "ok").length;
    const totalRows = results.reduce((acc, r) => acc + r.rows, 0);

    await sb.from("standalone_mode").upsert(
      {
        company_db: companyDb,
        snapshot_at: new Date().toISOString(),
        snapshot_summary: { results, ok: okCount, total_rows: totalRows, expires_at: expiresAt },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_db" },
    );

    return new Response(
      JSON.stringify({ success: true, company_db: companyDb, ok: okCount, total_rows: totalRows, expires_at: expiresAt, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
