/**
 * Regra de negócio: gastos de cartão corporativo (PagCorp) NÃO passam pelo
 * fluxo interno de aprovação — vão direto para integração no ERP.
 *
 * O documento pode chegar de duas formas:
 *  - pela tela do PagCorp (origin = "pagcorp");
 *  - digitado manualmente pelo time de cartões, com "PagCorp" na observação.
 * Ambos os casos são tratados como transação de cartão.
 */
const PAGCORP_REMARK = /pag\s*corp/i;

export function isPagCorpExpense(origin: unknown, remarks?: unknown): boolean {
  if (String(origin ?? "").trim().toLowerCase() === "pagcorp") return true;
  const text = String(remarks ?? "");
  return text.length > 0 && PAGCORP_REMARK.test(text);
}
