// Motor de critérios da matriz de alçadas — porta Deno de `src/lib/approvalSegments.ts`
// mais o fallback hierárquico de centro de custo (`src/lib/approval-fallback.ts`).
//
// Mantém a MESMA semântica do cliente para que o reprocessamento server-side
// chegue ao mesmo aprovador que a criação do documento chegaria.

export interface RuleCriterion {
  field: string;
  operator: string;
  value?: string | number | null;
  value2?: string | number | null;
  logic?: string;
  groupLogic?: string;
  group?: number;
}

export interface RuleRow {
  id: string;
  name?: string | null;
  is_active: boolean;
  auto_approve?: boolean | null;
  priority?: number | null;
  doc_type?: string | null;
  criteria: RuleCriterion[] | unknown;
  company_db?: string | null;
}

export function evaluateCriterion(c: RuleCriterion, ctx: Record<string, unknown>): boolean {
  const raw = ctx[c.field];
  if (raw === undefined || raw === null) return false;
  const val = String(raw).toLowerCase();
  const target = String(c.value ?? "").toLowerCase();
  const tokens = val.split(/\s+/).filter(Boolean);
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** Compila um padrão SQL-like ("1.2.%") em regex. */
  const likeTest = (pattern: string): boolean => {
    const clean = pattern.trim().replace(/^%\s+/, "%").replace(/\s+%$/, "%");
    const src = clean
      .split("")
      .map((ch) => (ch === "%" ? ".*" : ch === "_" ? "." : escapeRegex(ch)))
      .join("");
    try {
      const re = new RegExp(`^${src}$`);
      return re.test(val) || tokens.some((t) => re.test(t));
    } catch {
      return false;
    }
  };
  // Regras salvas com operador "igual" mas valor curinga ("1.2.%") devem se
  // comportar como LIKE — senão nunca casam e o documento cai no fallback.
  const matchesExact = target.includes("%")
    ? likeTest(target)
    : val === target || tokens.includes(target);

  switch (c.operator) {
    case "greater_than":
      return Number(raw) > Number(c.value);
    case "less_than":
      return Number(raw) < Number(c.value);
    case "between":
      return Number(raw) >= Number(c.value) && Number(raw) <= Number(c.value2 ?? c.value);
    case "equal":
      return matchesExact;
    case "not_equal":
      return !matchesExact;
    case "contains":
      return val.includes(target);
    case "not_contains":
      return !val.includes(target);
    case "like":
      return likeTest(target);
    default:
      return false;
  }
}


export function evaluateCriteria(criteria: RuleCriterion[], ctx: Record<string, unknown>): boolean {
  if (!criteria || criteria.length === 0) return false;
  const groupOrder: number[] = [];
  const buckets = new Map<number, RuleCriterion[]>();
  for (const c of criteria) {
    const g = typeof c.group === "number" ? c.group : 0;
    if (!buckets.has(g)) {
      buckets.set(g, []);
      groupOrder.push(g);
    }
    buckets.get(g)!.push(c);
  }
  let groupIdx = 0;
  let overall = false;
  for (const g of groupOrder) {
    const bucket = buckets.get(g)!;
    let acc = evaluateCriterion(bucket[0], ctx);
    for (let i = 1; i < bucket.length; i++) {
      const passed = evaluateCriterion(bucket[i], ctx);
      const raw = bucket[i].logic;
      const logic = raw === "or" || raw === "either" ? "or" : "and";
      acc = logic === "or" ? acc || passed : acc && passed;
    }
    if (groupIdx === 0) overall = acc;
    else {
      const rawG = bucket[0].groupLogic;
      const gLogic = rawG === "or" || rawG === "either" ? "or" : "and";
      overall = gLogic === "and" ? overall && acc : overall || acc;
    }
    groupIdx++;
  }
  return overall;
}

function criteriaOf(r: RuleRow): RuleCriterion[] {
  return Array.isArray(r.criteria) ? (r.criteria as RuleCriterion[]) : [];
}

function applies(r: RuleRow, docType: string): boolean {
  if (!r.is_active) return false;
  const rdt = r.doc_type;
  return !rdt || rdt === "both" || rdt === docType;
}

export function findMatchingRule(rules: RuleRow[], ctx: Record<string, unknown>, docType: string): RuleRow | null {
  const scoped = rules
    .filter((r) => applies(r, docType))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const r of scoped) {
    const criteria = criteriaOf(r);
    if (criteria.length === 0) {
      if (r.auto_approve) return r;
      continue;
    }
    if (evaluateCriteria(criteria, ctx)) return r;
  }
  return null;
}

/** "1.80.1.3" → ["1.80.1", "1.80"] */
export function costCenterParents(cc: string): string[] {
  const parts = String(cc || "").trim().split(".").filter(Boolean);
  const out: string[] = [];
  for (let n = parts.length - 1; n >= 2; n--) out.push(parts.slice(0, n).join("."));
  return out;
}

export interface HierarchicalFallback {
  rule: RuleRow;
  matchedBranch: string;
  siblingCostCenter: string;
}

/** Regra do ramo mais próximo do CC (quando o CC exato não tem alçada). */
export function pickHierarchicalFallbackRule(
  rules: RuleRow[],
  ctx: Record<string, unknown>,
  docType: string,
): HierarchicalFallback | null {
  const cc = String(ctx.cost_center ?? "").trim();
  if (!cc) return null;
  const applicable = rules.filter((r) => applies(r, docType));

  for (const branch of costCenterParents(cc)) {
    const candidates: HierarchicalFallback[] = [];
    for (const r of applicable) {
      const criteria = criteriaOf(r);
      const ccValues = criteria
        .filter((c) => c.field === "cost_center")
        .map((c) => String(c.value ?? "").trim())
        .filter(Boolean);
      const sibling = ccValues.find((v) => v === branch || v.startsWith(`${branch}.`));
      if (!sibling) continue;
      const rest = criteria.filter((c) => c.field !== "cost_center");
      if (rest.length > 0 && !evaluateCriteria(rest, ctx)) continue;
      candidates.push({ rule: r, matchedBranch: branch, siblingCostCenter: sibling });
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => (b.rule.priority || 0) - (a.rule.priority || 0));
      return candidates[0];
    }
  }
  return null;
}
