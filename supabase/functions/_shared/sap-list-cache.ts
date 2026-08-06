// Invalidação server-side do cache de listas do ERP (`public.sap_cache`).
//
// As telas usam `useSapCachedList`, que mantém as listas do SAP (fornecedores,
// clientes, itens, centros de custo, projetos) em `sap_cache`. Sempre que uma
// edge function escreve um cadastro mestre no SAP, precisamos apagar as chaves
// derivadas daquela entidade: a exclusão dispara um evento Realtime e todas as
// telas abertas recarregam a lista automaticamente, sem esperar o TTL.

type Sb = {
  from: (table: string) => any;
};

export type SapCacheFamily =
  | "business_partners"
  | "items"
  | "cost_centers"
  | "projects";

const STATIC_KEYS: Record<SapCacheFamily, string[]> = {
  business_partners: ["suppliers_active_v2", "suppliers_active_v3", "customers_active_v2"],
  items: [
    "items_purchase_active_v3",
    "items_purchase_active_v4",
    "items_sales_active_v3",
    "items_active_v2",
  ],
  cost_centers: ["cost_centers"],
  projects: ["projects"],
};

const DYNAMIC_KEY_PREFIX: Partial<Record<SapCacheFamily, string[]>> = {
  business_partners: ["suppliers", "customers"],
  items: ["items_all"],
};

/** Chaves de cache afetadas por uma família de cadastro mestre. */
export function sapCacheKeysFor(family: SapCacheFamily, companyDb: string): string[] {
  const keys = [...STATIC_KEYS[family]];
  for (const prefix of DYNAMIC_KEY_PREFIX[family] ?? []) keys.push(`${prefix}:${companyDb}`);
  return keys;
}

/**
 * Apaga as linhas de cache da família informada para a base. Best-effort:
 * nunca lança — falhar aqui não pode derrubar a operação de negócio.
 */
export async function purgeSapListCache(
  sb: Sb,
  companyDb: string,
  family: SapCacheFamily,
): Promise<void> {
  if (!companyDb) return;
  try {
    await sb
      .from("sap_cache")
      .delete()
      .eq("company_db", companyDb)
      .in("cache_key", sapCacheKeysFor(family, companyDb));
  } catch (e) {
    console.warn(`purgeSapListCache(${family}) falhou:`, (e as Error).message);
  }
}
