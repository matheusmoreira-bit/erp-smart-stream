/**
 * Deduplicação de documentos de despesa/venda entre usuários.
 *
 * - `hashFileContent`: SHA-256 hex do conteúdo binário (sem nome/tamanho).
 *   É a chave cross-user — se dois usuários anexarem o MESMO arquivo,
 *   o hash bate.
 * - `findExistingClaims`: consulta a tabela `submitted_document_hashes`
 *   e devolve as linhas que já existem.
 * - `claimDocumentHashes`: INSERT das novas hashes; UNIQUE constraint
 *   garante atomicidade (o segundo submit paralelo falha e é tratado
 *   como duplicado pelo caller).
 *
 * Também expõe pequenas funções puras (`partitionDuplicates`,
 * `hasInFlightGuardTripped`) que servem tanto ao módulo quanto aos testes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const LOG_PREFIX = "[expense-dedupe]";

export interface DocumentClaim {
  fileHash: string;
  fileName?: string;
  fileSize?: number;
  companyDb?: string | null;
  docType?: string | null;
  supplierLabel?: string | null;
  expenseId?: string | null;
}

export interface ExistingClaim {
  file_hash: string;
  submitted_by: string;
  supplier_label: string | null;
  doc_type: string | null;
  file_name: string | null;
  created_at: string;
}

/** SHA-256 hex do conteúdo binário. NÃO inclui nome/tamanho, pois o objetivo
 *  aqui é detectar o MESMO documento entre usuários diferentes. */
export async function hashFileContent(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Consulta a tabela para saber quais hashes já foram lançados (por qualquer
 *  usuário). Retorna as linhas existentes. */
export async function findExistingClaims(
  supabase: SupabaseClient,
  hashes: string[],
): Promise<ExistingClaim[]> {
  if (!hashes || hashes.length === 0) return [];
  const uniq = Array.from(new Set(hashes));
  const { data, error } = await supabase
    .from("submitted_document_hashes")
    .select("file_hash, submitted_by, supplier_label, doc_type, file_name, created_at")
    .in("file_hash", uniq);
  if (error) {
    console.warn(LOG_PREFIX, "findExistingClaims falhou (bloqueando por segurança):", error);
    throw error;
  }
  return (data as ExistingClaim[]) ?? [];
}

/** Insere as reivindicações. Se alguma bater com UNIQUE, o insert falha em
 *  bloco; o caller deve re-consultar via `findExistingClaims` para reportar. */
export async function claimDocumentHashes(
  supabase: SupabaseClient,
  submittedBy: string,
  claims: DocumentClaim[],
): Promise<{ inserted: number; conflict: boolean; error?: unknown }> {
  if (!claims || claims.length === 0) return { inserted: 0, conflict: false };
  const rows = claims.map((c) => ({
    file_hash: c.fileHash,
    submitted_by: submittedBy,
    file_name: c.fileName ?? null,
    file_size: c.fileSize ?? null,
    company_db: c.companyDb ?? null,
    doc_type: c.docType ?? null,
    supplier_label: c.supplierLabel ?? null,
    expense_id: c.expenseId ?? null,
  }));
  const { error, data } = await supabase
    .from("submitted_document_hashes")
    .insert(rows)
    .select("file_hash");
  if (error) {
    // 23505 = unique_violation. Sinaliza corrida com outro usuário.
    const code = (error as { code?: string }).code;
    const conflict = code === "23505";
    console.warn(LOG_PREFIX, "claimDocumentHashes falhou", { code, conflict });
    return { inserted: 0, conflict, error };
  }
  console.info(LOG_PREFIX, "claimed", { inserted: data?.length ?? 0 });
  return { inserted: data?.length ?? 0, conflict: false };
}

/** Separa uma lista de hashes em (novos, duplicados) dado um conjunto de
 *  hashes já existentes. Pura — usada por testes e pelo modal. */
export function partitionDuplicates(
  hashes: string[],
  existing: Iterable<string>,
): { fresh: string[]; duplicates: string[] } {
  const set = new Set(existing);
  const fresh: string[] = [];
  const duplicates: string[] = [];
  for (const h of hashes) {
    if (set.has(h)) duplicates.push(h);
    else fresh.push(h);
  }
  return { fresh, duplicates };
}

/**
 * Guard reentrante: retorna `true` quando uma operação (submit/AI) já está em
 * andamento e a nova chamada deve ser IGNORADA. Se `false`, o caller marca o
 * ref (`ref.current = true`) e prossegue — depois libera no `finally`.
 */
export function hasInFlightGuardTripped(ref: { current: boolean }): boolean {
  return ref.current === true;
}
