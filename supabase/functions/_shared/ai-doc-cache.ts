/**
 * Cache de análises de documentos por IA.
 *
 * Objetivo: nunca pagar/reprocessar a mesma avaliação de IA duas vezes para o
 * mesmo conteúdo (pedido de compra, NF de entrada, pagamentos, fornecedor...).
 *
 * A chave é um hash SHA-256 determinístico do escopo + modelo + entradas
 * relevantes (ids, caminhos de anexo, tamanhos, prompt). Nenhum conteúdo
 * sensível é gravado na chave — apenas o digest.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export async function hashInput(parts: unknown): Promise<string> {
  const text = typeof parts === "string" ? parts : JSON.stringify(parts);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CacheKey {
  scope: string;
  inputHash: string;
}

export interface CachedAnalysis<T> {
  result: T;
  cached: true;
  analyzedAt: string;
}

/** Busca uma análise já feita. Incrementa o contador de reaproveitamento. */
export async function getCachedAnalysis<T>(
  db: Db,
  key: CacheKey,
): Promise<CachedAnalysis<T> | null> {
  try {
    const { data, error } = await db
      .from("ai_document_analyses")
      .select("id, result, hit_count, created_at")
      .eq("scope", key.scope)
      .eq("input_hash", key.inputHash)
      .maybeSingle();
    if (error || !data) return null;
    // Uso é registrado de forma best-effort; falha aqui não invalida o cache.
    db.from("ai_document_analyses")
      .update({ hit_count: (data.hit_count ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("id", data.id)
      .then(() => {}, () => {});
    return { result: data.result as T, cached: true, analyzedAt: data.created_at as string };
  } catch {
    return null;
  }
}

/** Guarda o resultado da análise. Erros são ignorados (cache é otimização). */
export async function saveAnalysis(
  db: Db,
  key: CacheKey,
  result: unknown,
  meta?: {
    model?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    companyDb?: string | null;
    createdBy?: string | null;
  },
): Promise<void> {
  try {
    await db.from("ai_document_analyses").upsert({
      scope: key.scope,
      input_hash: key.inputHash,
      model: meta?.model ?? null,
      entity_type: meta?.entityType ?? null,
      entity_id: meta?.entityId ?? null,
      company_db: meta?.companyDb ?? null,
      created_by: meta?.createdBy ?? null,
      result,
      hit_count: 0,
      last_used_at: new Date().toISOString(),
    }, { onConflict: "scope,input_hash" });
  } catch {
    /* ignore */
  }
}

/** Invalida uma análise (ex.: usuário marcou vinculação incorreta). */
export async function invalidateAnalysis(db: Db, key: CacheKey): Promise<void> {
  try {
    await db.from("ai_document_analyses").delete().eq("scope", key.scope).eq("input_hash", key.inputHash);
  } catch {
    /* ignore */
  }
}
