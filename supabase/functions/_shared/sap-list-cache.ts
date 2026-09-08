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
 * Marca o cache da família informada como vencido (revalidação imediata pelas
 * telas abertas), SEM apagar os dados: o cache de cadastros é perene e só é
 * atualizado por upsert. Best-effort: nunca lança.
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
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("company_db", companyDb)
      .in("cache_key", sapCacheKeysFor(family, companyDb));
  } catch (e) {
    console.warn(`purgeSapListCache(${family}) falhou:`, (e as Error).message);
  }
}


// ---------------------------------------------------------------------------
// Cache perene de cadastros: upsert linha a linha
// ---------------------------------------------------------------------------
// Cadastros mestres são incrementais em cada base. As gravações no `sap_cache`
// não substituem a lista inteira: mesclam as linhas novas sobre as já
// armazenadas (chave natural do cadastro), preservando o que não veio na
// resposta atual do ERP.

const IDENTITY_FIELDS = [
  "CardCode", "ItemCode", "CenterCode", "PrjCode", "UserCode",
  "Code", "AbsEntry", "GroupCode", "code", "id",
];

export function cacheRowIdentity(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  for (const f of IDENTITY_FIELDS) {
    const v = r[f];
    if (v !== undefined && v !== null && String(v).trim() !== "") return `${f}:${String(v)}`;
  }
  return null;
}

export function mergeCacheRows(existing: unknown[], incoming: unknown[]): unknown[] {
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;
  const byId = new Map<string, unknown>();
  const noId: unknown[] = [];
  for (const row of existing) {
    const id = cacheRowIdentity(row);
    if (id) byId.set(id, row); else noId.push(row);
  }
  let anyIncomingId = false;
  for (const row of incoming) {
    const id = cacheRowIdentity(row);
    if (id) { anyIncomingId = true; byId.set(id, row); }
  }
  if (!anyIncomingId) return incoming;
  return [...byId.values(), ...noId];
}

/** Upsert com merge das linhas já armazenadas (cache perene de cadastros). */
export async function upsertSapCacheMerged(
  sb: Sb,
  cacheKey: string,
  companyDb: string,
  rows: unknown[],
  expiresAt: string,
): Promise<void> {
  let merged = rows;
  try {
    const { data } = await sb
      .from("sap_cache")
      .select("data")
      .eq("cache_key", cacheKey)
      .eq("company_db", companyDb)
      .maybeSingle();
    const previous = (data?.data as unknown[]) || [];
    merged = mergeCacheRows(previous, rows);
  } catch (e) {
    console.warn(`upsertSapCacheMerged(${cacheKey}) merge falhou:`, (e as Error).message);
  }
  const { error } = await sb.from("sap_cache").upsert(
    { cache_key: cacheKey, company_db: companyDb, data: merged, expires_at: expiresAt },
    { onConflict: "cache_key,company_db" },
  );
  if (error) throw new Error(`Upsert sap_cache (${cacheKey}): ${error.message}`);
}
