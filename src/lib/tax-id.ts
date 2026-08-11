/**
 * Normalização de documentos fiscais (CPF/CNPJ).
 *
 * A Receita Federal passou a permitir CNPJ alfanumérico, e a API do PagCorp
 * (campo `aiAnalysis.companyDocument`) pode devolver letras. Por isso a
 * normalização usada em comparações preserva letras — nunca use
 * `replace(/\D/g, "")` para casar documentos vindos de fontes externas.
 */

/** Chave canônica para comparar documentos: alfanumérico, maiúsculo, sem máscara. */
export function normalizeTaxKey(value?: string | null): string {
  return (value || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** Apenas dígitos — use somente onde o destino exige documento numérico. */
export function taxDigits(value?: string | null): string {
  return (value || "").replace(/\D/g, "");
}

/**
 * CPF (11 dígitos) ou CNPJ (14 caracteres alfanuméricos, conforme a nova
 * regulamentação da Receita Federal).
 */
export function isValidBrTaxId(value?: string | null): boolean {
  const key = normalizeTaxKey(value);
  if (key.length === 11) return /^\d{11}$/.test(key);
  return key.length === 14;
}

/** Formata CPF/CNPJ para exibição, mantendo caracteres alfanuméricos. */
export function formatTaxId(value?: string | null): string {
  const key = normalizeTaxKey(value);
  if (key.length === 11) {
    return `${key.slice(0, 3)}.${key.slice(3, 6)}.${key.slice(6, 9)}-${key.slice(9)}`;
  }
  if (key.length === 14) {
    return `${key.slice(0, 2)}.${key.slice(2, 5)}.${key.slice(5, 8)}/${key.slice(8, 12)}-${key.slice(12)}`;
  }
  return value?.trim() || "";
}
