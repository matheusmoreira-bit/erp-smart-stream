// Authorization helpers mirroring the logic in
// supabase/functions/expense-approval-action/index.ts. Kept pure and
// dependency-free so we can exercise the delegation flow in unit/E2E tests
// without spinning up the edge function.

/**
 * Retorna `true` somente se o documento ainda está aguardando decisões de
 * aprovação. É a única fonte de verdade para exibir "Aprovador atual" ou
 * marcar um nível como "atual" em qualquer tela.
 *
 * Regra do negócio: se o documento foi aprovado em todos os níveis de todas
 * as ramificações (rateios), o status deixa de ser "atual" e passa a ser
 * "aprovado" — mesmo que `current_approver` ainda tenha um valor herdado.
 */
export function isPendingApproval(status?: string | null): boolean {
  return String(status || "").toLowerCase() === "pendente_aprovacao";
}


export function normalize(s: unknown): string {
  return String(s ?? "").toLowerCase().trim();
}

export function emailPrefix(email: string): string {
  const e = normalize(email);
  const i = e.indexOf("@");
  return i > 0 ? e.slice(0, i) : e;
}

export function tokenize(s: string): string[] {
  return normalize(s).replace(/[._\-@]+/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Strict identity match — no fuzzy edit distance. Accepts:
 *   - caller == approver email                              (exact)
 *   - prefix-before-@ of caller == prefix-before-@ of email (SAP UserCode)
 *   - normalized token set of caller ⊆ token set of approver name
 *     AND at least one token in common
 */
export function isDesignatedApprover(
  caller: string,
  approverName: string | null,
  approverEmail: string | null,
): boolean {
  const c = normalize(caller);
  if (!c) return false;

  const ae = normalize(approverEmail);
  if (ae) {
    if (c === ae) return true;
    if (emailPrefix(c) === emailPrefix(ae) && emailPrefix(ae).length > 0) return true;
  }

  const nameTokens = tokenize(approverName || "");
  const callerTokens = tokenize(caller);
  if (nameTokens.length === 0 || callerTokens.length === 0) return false;
  const allIn = callerTokens.every((t) => nameTokens.includes(t));
  if (!allIn) return false;
  if (callerTokens.length >= 2) return true;
  return nameTokens.length === 1;
}

export interface ApprovalRuleLevel {
  level_order: number;
  approver_name: string;
  approver_email: string | null;
}

export interface InternalExpense {
  id: string;
  status: "pendente_aprovacao" | "aprovado" | "rejeitado";
  current_level_order: number;
  current_approver: string | null;
  original_approver: string | null;
  requester_email?: string | null;
  requester_name?: string | null;
  rule_levels: ApprovalRuleLevel[];
}

/**
 * Resolve o(s) aprovador(es) designado(s) para o nível atual. Suporta
 * APROVADORES PARALELOS: múltiplas linhas com o mesmo `level_order`.
 * Um override em `current_approver` (delegação) toma precedência sobre a
 * regra e retorna uma lista com um único item.
 */
export function resolveDesignatedApprovers(exp: InternalExpense): Array<{
  name: string | null;
  email: string | null;
}> {
  const override = (exp.current_approver || "").trim() || null;
  if (override) {
    const isEmail = override.includes("@");
    return [{ name: isEmail ? null : override, email: isEmail ? override : null }];
  }
  const rows = exp.rule_levels.filter((l) => l.level_order === exp.current_level_order);
  if (rows.length === 0) return [{ name: null, email: null }];
  return rows.map((r) => ({ name: r.approver_name || null, email: r.approver_email || null }));
}

/** @deprecated compat — devolve o PRIMEIRO aprovador do nível atual. */
export function resolveDesignatedApprover(exp: InternalExpense): {
  name: string | null;
  email: string | null;
} {
  return resolveDesignatedApprovers(exp)[0] || { name: null, email: null };
}

export function canCallerApproveInternal(caller: string, exp: InternalExpense): boolean {
  if (exp.status !== "pendente_aprovacao") return false;
  const candidates = resolveDesignatedApprovers(exp);
  return candidates.some(({ name, email }) => isDesignatedApprover(caller, name, email));
}
