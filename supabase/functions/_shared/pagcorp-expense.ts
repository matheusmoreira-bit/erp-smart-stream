/**
 * Regra de negócio: gastos de cartão corporativo (PagCorp) NÃO passam pelo
 * fluxo interno de aprovação — vão direto para integração no ERP.
 *
 * Segurança (F04): a origem PagCorp é definida SOMENTE pelo servidor
 * (expense-mutation valida acesso ao módulo "pagcorp" antes de aceitar
 * origin = "pagcorp"). Nunca inferir a origem de texto livre (observação).
 */
export function isPagCorpExpense(origin: unknown): boolean {
  return String(origin ?? "").trim().toLowerCase() === "pagcorp";
}
