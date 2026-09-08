// Cache perene de cadastros mestres do ERP (`public.sap_cache`).
//
// Cadastros (fornecedores, clientes, itens, centros de custo, projetos,
// usuários…) são incrementais em cada base: registros novos aparecem, mas os
// antigos continuam existindo. Por isso o cache local NUNCA é apagado — ele é
// atualizado por upsert linha a linha (merge por chave de identidade).
//
// Consequências:
// - uma leitura incompleta/lenta do ERP não zera a lista da tela;
// - invalidação = marcar como vencido (revalidar), não apagar;
// - só um "resync completo" (recarregar manualmente) substitui a lista inteira.

/** Campos usados como identidade natural dos cadastros do ERP. */
const IDENTITY_FIELDS = [
  "CardCode",
  "ItemCode",
  "CenterCode",
  "PrjCode",
  "UserCode",
  "Code",
  "AbsEntry",
  "GroupCode",
  "code",
  "id",
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

/**
 * Faz o merge (upsert) das linhas novas sobre as já armazenadas.
 * As linhas novas vencem; as antigas que não vieram na resposta são mantidas.
 */
export function mergeCacheRows(existing: unknown[], incoming: unknown[]): unknown[] {
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;

  const byId = new Map<string, unknown>();
  const noId: unknown[] = [];

  for (const row of existing) {
    const id = cacheRowIdentity(row);
    if (id) byId.set(id, row);
    else noId.push(row);
  }

  let anyIncomingId = false;
  for (const row of incoming) {
    const id = cacheRowIdentity(row);
    if (id) {
      anyIncomingId = true;
      byId.set(id, row);
    }
  }

  // Sem identidade reconhecível nas linhas novas: não dá para casar registros,
  // então a resposta nova substitui a anterior.
  if (!anyIncomingId) return incoming;

  return [...byId.values(), ...noId];
}
