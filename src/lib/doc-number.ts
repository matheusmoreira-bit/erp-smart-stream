/**
 * Rótulo do número do documento.
 *
 * Documentos vindos do ERP têm DocNum numérico. Despesas internas (criadas no
 * ERP Flow e ainda não integradas) não têm DocNum — nesses casos exibimos o
 * código interno do documento (mesmo código enviado na observação do SAP:
 * os 8 primeiros caracteres do id, em maiúsculas).
 */

export function internalDocCode(id?: string | null): string {
  const raw = String(id || "").replace(/-/g, "").trim();
  return raw ? raw.slice(0, 8).toUpperCase() : "";
}

export function docNumberLabel(
  doc?: { docNum?: number | null; __internalId?: string | null } | null,
): string {
  const num = Number(doc?.docNum || 0);
  if (num > 0) return `#${num}`;
  const code = internalDocCode((doc as { __internalId?: string | null } | null | undefined)?.__internalId);
  return code ? `#${code}` : "#—";
}

/** Verdadeiro quando o documento é interno (sem nº do ERP). */
export function isInternalDoc(
  doc?: { docNum?: number | null } | null,
): boolean {
  return !(Number(doc?.docNum || 0) > 0);
}

/** Normaliza uma busca por número de documento (remove #, espaços e hífens). */
export function normalizeDocQuery(q: string): string {
  return String(q || "").replace(/[#\s-]/g, "").toLowerCase();
}

/**
 * Casa uma busca livre com o nº do ERP OU o código interno do documento.
 * Aceita "#A38F5BF9", "a38f5bf9", "a38f5bf9-ed6d-..." e "208".
 */
export function matchesDocQuery(
  doc: { docNum?: number | null; __internalId?: string | null } | null | undefined,
  query: string,
): boolean {
  const q = normalizeDocQuery(query);
  if (!q) return true;
  const num = String(Number(doc?.docNum || 0) || "");
  if (num && num.includes(q)) return true;
  const id = String(doc?.__internalId || "").replace(/-/g, "").toLowerCase();
  if (!id) return false;
  return id.startsWith(q) || internalDocCode(id).toLowerCase().includes(q);
}

/**
 * Rótulo padronizado para exportações (CSV/PDF) e listas: nº do ERP quando
 * existir, senão o código interno do documento. Nunca retorna "#0".
 */
export function exportDocLabel(
  input?: { docNum?: number | null; id?: string | null; sap_doc_num?: number | string | null; doc_num?: number | string | null; expense_id?: string | null; __internalId?: string | null } | null,
): string {
  const num = Number(input?.docNum ?? input?.sap_doc_num ?? input?.doc_num ?? 0);
  if (num > 0) return `#${num}`;
  const code = internalDocCode(input?.__internalId ?? input?.expense_id ?? input?.id);
  return code ? `#${code}` : "—";
}
