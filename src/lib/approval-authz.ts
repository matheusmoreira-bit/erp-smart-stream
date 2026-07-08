// Authorization helpers mirroring the logic in
// supabase/functions/expense-approval-action/index.ts. Kept pure and
// dependency-free so we can exercise the delegation flow in unit/E2E tests
// without spinning up the edge function.

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
 * Resolve the effective designated approver for the current level, honoring
 * `current_approver` as an override (this is how delegation actually shifts
 * authorization on internal expenses).
 */
export function resolveDesignatedApprover(exp: InternalExpense): {
  name: string | null;
  email: string | null;
} {
  const currentRow = exp.rule_levels.find((l) => l.level_order === exp.current_level_order) || null;
  const override = (exp.current_approver || "").trim() || null;
  const overrideIsEmail = !!override && override.includes("@");
  return {
    name: override || currentRow?.approver_name || null,
    email: overrideIsEmail ? override : (currentRow?.approver_email || null),
  };
}

export function canCallerApproveInternal(caller: string, exp: InternalExpense): boolean {
  if (exp.status !== "pendente_aprovacao") return false;
  const { name, email } = resolveDesignatedApprover(exp);
  return isDesignatedApprover(caller, name, email);
}
