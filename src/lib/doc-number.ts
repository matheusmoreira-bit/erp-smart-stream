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
