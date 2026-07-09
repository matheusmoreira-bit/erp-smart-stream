import type { ApprovalRule, RuleCriterion, RuleDocType } from "@/hooks/useApprovalRules";
import type { ApprovalDoc, DocumentLine } from "@/hooks/useApprovals";

/**
 * Avalia um critério contra um contexto. Mesmo shape usado pelo simulador
 * (`RuleSimulator`) e pela criação de despesas (`useExpenses`).
 */
export function evaluateCriterion(
  c: RuleCriterion,
  ctx: Record<string, unknown>,
): boolean {
  const raw = ctx[c.field];
  if (raw === undefined || raw === null) return false;
  const val = String(raw).toLowerCase();
  const target = String(c.value ?? "").toLowerCase();
  const tokens = val.split(/\s+/).filter(Boolean);
  const matchesExact = val === target || tokens.includes(target);
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  switch (c.operator) {
    case "greater_than":
      return Number(raw) > Number(c.value);
    case "less_than":
      return Number(raw) < Number(c.value);
    case "between":
      return (
        Number(raw) >= Number(c.value) &&
        Number(raw) <= Number(c.value2 ?? c.value)
      );
    case "equal":
      return matchesExact;
    case "not_equal":
      return !matchesExact;
    case "contains":
      return val.includes(target);
    case "not_contains":
      return !val.includes(target);
    case "like": {
      const pattern = target.split("").map((ch) => ch === "%" ? ".*" : ch === "_" ? "." : escapeRegex(ch)).join("");
      try {
        const re = new RegExp(`^${pattern}$`);
        return re.test(val) || tokens.some((t) => re.test(t));
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Avalia uma lista de critérios com suporte a GRUPOS.
 *
 * - Cada critério pode ter `group` (0-based). Critérios sem grupo caem no grupo 0.
 * - Dentro do grupo, critérios são combinados esquerda→direita pelo conector `logic`
 *   (padrão "and") aplicado a partir do 2º critério do grupo.
 * - Entre grupos, o resultado de cada grupo é combinado esquerda→direita pelo conector
 *   `groupLogic` do PRIMEIRO critério de cada grupo (a partir do 2º grupo).
 *
 * FALLBACK LEGADO: quando `logic` ou `groupLogic` não existem (regras antigas,
 * anteriores ao seletor E/OU), assumimos `"and"` para preservar o
 * comportamento original (equivalente a `criteria.every(...)`).
 */
export function evaluateCriteria(
  criteria: RuleCriterion[],
  ctx: Record<string, unknown>,
): boolean {
  if (!criteria || criteria.length === 0) return false;

  // Group criteria preserving order of first appearance.
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
    // Within-group combination.
    let acc = evaluateCriterion(bucket[0], ctx);
    for (let i = 1; i < bucket.length; i++) {
      const passed = evaluateCriterion(bucket[i], ctx);
      const logic = bucket[i].logic === "or" ? "or" : "and"; // fallback → AND
      acc = logic === "or" ? (acc || passed) : (acc && passed);
    }
    // Between-group combination.
    if (groupIdx === 0) {
      overall = acc;
    } else {
      const gLogic = bucket[0].groupLogic === "or" ? "or" : "and"; // fallback → AND
      overall = gLogic === "and" ? (overall && acc) : (overall || acc);
    }
    groupIdx++;
  }
  return overall;
}


function inferDocTypeFromName(name?: string): RuleDocType {
  const n = (name || "").toLowerCase();
  if (n.includes("venda") || n.includes("cliente") || n.includes("sales")) return "sales";
  return "purchase";
}

/**
 * Escolhe a regra vencedora para um contexto: apenas ativas, doc_type compatível,
 * maior prioridade primeiro; a primeira cujos critérios TODOS batem vence.
 */
export function findMatchingRule(
  rules: ApprovalRule[],
  ctx: Record<string, unknown>,
  docType: RuleDocType,
): ApprovalRule | null {
  const scoped = rules
    .filter((r) => r.is_active)
    .filter((r) => {
      const rdt = r.doc_type;
      return !rdt || rdt === "both" || rdt === docType;
    })
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const r of scoped) {
    const criteria = Array.isArray(r.criteria) ? r.criteria : [];
    if (criteria.length === 0) continue;
    if (evaluateCriteria(criteria, ctx)) return r;
  }
  return null;
}

export interface ApprovalSegment {
  /** Chave do agrupamento — código do centro de custo ou "__no_cc__". */
  costCenter: string;
  lines: DocumentLine[];
  amount: number;
  amountFC: number;
  pct: number;
  rule: ApprovalRule | null;
  /** Emails/nomes na cadeia (ordenados por level_order). */
  approverEmails: string[];
  approverNames: string[];
}

function toList(arr: string[]): string {
  return ` ${arr
    .map((x) => (x || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ")} `;
}

/**
 * Agrupa as linhas do documento por CostingCode e resolve, para cada grupo,
 * qual regra do app aplicaria e qual seria a cadeia de aprovadores.
 *
 * Se todos os grupos resolverem para a MESMA regra (mesmo id), retorna um único
 * segmento com todas as linhas — significa "sem segmentação".
 */
export function segmentDocByRules(
  doc: ApprovalDoc,
  rules: ApprovalRule[],
): ApprovalSegment[] {
  const lines = Array.isArray(doc.documentLines) ? doc.documentLines : [];
  if (lines.length === 0) return [];

  const docType = inferDocTypeFromName(doc.docTypeName);
  const totalAll = lines.reduce((s, l) => s + Number(l.LineTotal || 0), 0);
  const groups = new Map<string, DocumentLine[]>();
  for (const l of lines) {
    const key = (l.CostingCode || "").trim() || "__no_cc__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }

  const segments: ApprovalSegment[] = [];
  for (const [cc, groupLines] of groups.entries()) {
    const amount = groupLines.reduce((s, l) => s + Number(l.LineTotal || 0), 0);
    const amountFC = groupLines.reduce(
      (s, l) => s + Number(l.LineTotalFC ?? l.LineTotal ?? 0),
      0,
    );
    const codes = toList(groupLines.map((l) => l.ItemCode || ""));
    const names = toList(groupLines.map((l) => l.Description || ""));
    const any = toList(groupLines.flatMap((l) => [l.ItemCode || "", l.Description || ""]));
    const ctx: Record<string, unknown> = {
      total_amount: doc.currency !== "BRL" ? amountFC : amount,
      cost_center: cc === "__no_cc__" ? "" : cc,
      project: (groupLines.find((l) => l.Project)?.Project || "").trim(),
      requester_name: doc.requester || "",
      // Legado: combinação nome + código.
      supplier_name: `${doc.cardName || ""} ${doc.cardCode || ""}`.trim(),
      "supplier.name": (doc.cardName || "").toLowerCase(),
      "supplier.code": (doc.cardCode || "").toLowerCase(),
      // CNPJ/status não estão no ApprovalDoc — deixa vazio para regras que não os usem.
      "supplier.cnpj": "",
      "supplier.status": "",
      currency: (doc.currency || "BRL").toUpperCase(),
      doc_type: docType,
      item_codes: any,
      item_groups: "",
      "item.code": codes,
      "item.name": names,
      "item.any": any,
    };
    const rule = findMatchingRule(rules, ctx, docType);
    const levels = rule ? [...rule.levels].sort((a, b) => a.level_order - b.level_order) : [];
    segments.push({
      costCenter: cc,
      lines: groupLines,
      amount,
      amountFC,
      pct: totalAll > 0 ? (amount / totalAll) * 100 : 0,
      rule,
      approverEmails: levels
        .map((l) => (l.approver_email || "").trim().toLowerCase())
        .filter(Boolean),
      approverNames: levels
        .map((l) => (l.approver_name || "").trim())
        .filter(Boolean),
    });
  }

  // Se todos os segmentos apontam para a mesma regra (ou todos sem regra), colapsa.
  const distinctRuleIds = new Set(segments.map((s) => s.rule?.id || "__none__"));
  if (distinctRuleIds.size <= 1) {
    const total = segments.reduce((s, x) => s + x.amount, 0);
    const totalFC = segments.reduce((s, x) => s + x.amountFC, 0);
    const first = segments[0];
    return [
      {
        costCenter: "__all__",
        lines,
        amount: total,
        amountFC: totalFC,
        pct: 100,
        rule: first?.rule || null,
        approverEmails: first?.approverEmails || [],
        approverNames: first?.approverNames || [],
      },
    ];
  }

  return segments.sort((a, b) => b.amount - a.amount);
}

/** True se as segmentações realmente diferem entre grupos (mais de 1 regra distinta). */
export function isTrulySegmented(segments: ApprovalSegment[]): boolean {
  if (segments.length <= 1) return false;
  const ids = new Set(segments.map((s) => s.rule?.id || "__none__"));
  return ids.size > 1;
}

/**
 * Normaliza um identificador de aprovador (email OU nome) para comparação.
 * Aceita "matheus.moreira", "matheus.moreira@empresa", "Matheus Moreira".
 */
function normalizeApproverKey(v: string): string {
  const s = (v || "").trim().toLowerCase();
  if (!s) return "";
  // pega prefixo antes de @ para casar por login SAP com email da regra
  return s.includes("@") ? s.split("@")[0] : s;
}

/**
 * Retorna os segmentos onde o usuário informado aparece na cadeia de aprovadores.
 * Match tolerante: por email completo, por prefixo do email (login) e por nome.
 */
export function segmentsForApprover(
  segments: ApprovalSegment[],
  userName?: string,
  userEmail?: string,
): ApprovalSegment[] {
  const keys = new Set<string>();
  if (userName) keys.add(normalizeApproverKey(userName));
  if (userEmail) {
    keys.add((userEmail || "").trim().toLowerCase());
    keys.add(normalizeApproverKey(userEmail));
  }
  if (keys.size === 0) return [];
  return segments.filter((seg) => {
    const emails = seg.approverEmails.map((e) => e.toLowerCase());
    const emailPrefixes = emails.map((e) => normalizeApproverKey(e));
    const names = seg.approverNames.map((n) => normalizeApproverKey(n));
    for (const k of keys) {
      if (!k) continue;
      if (emails.includes(k) || emailPrefixes.includes(k) || names.includes(k)) return true;
    }
    return false;
  });
}
