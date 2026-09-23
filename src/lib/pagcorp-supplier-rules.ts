/**
 * Regras de fornecedor padrão por trecho da descrição da transação PagCorp.
 * Ex.: descrição começando com "CURSOR," → fornecedor F001636 na ANA Gaming.
 */

export type SupplierRuleMatchType = "startswith" | "contains";

export interface PagCorpSupplierRule {
  id?: string;
  company_db: string;
  pattern: string;
  match_type: SupplierRuleMatchType;
  supplier_code: string;
  supplier_name?: string | null;
  priority?: number | null;
  is_active?: boolean;
}

/** Normaliza para comparação: sem acentos, minúsculo, espaços colapsados. */
export function normalizeDescription(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function ruleMatches(rule: PagCorpSupplierRule, description: unknown): boolean {
  if (rule.is_active === false) return false;
  const pattern = normalizeDescription(rule.pattern);
  if (!pattern) return false;
  const text = normalizeDescription(description);
  if (!text) return false;
  return rule.match_type === "contains" ? text.includes(pattern) : text.startsWith(pattern);
}

/**
 * Retorna a regra aplicável: menor `priority` primeiro; em empate, o padrão
 * mais específico (mais longo) e "começa com" antes de "contém".
 */
export function findSupplierRule(
  rules: PagCorpSupplierRule[],
  description: unknown,
): PagCorpSupplierRule | null {
  const matches = rules.filter((r) => ruleMatches(r, description));
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const pa = a.priority ?? 100;
    const pb = b.priority ?? 100;
    if (pa !== pb) return pa - pb;
    if (a.match_type !== b.match_type) return a.match_type === "startswith" ? -1 : 1;
    return normalizeDescription(b.pattern).length - normalizeDescription(a.pattern).length;
  });
  return matches[0];
}
