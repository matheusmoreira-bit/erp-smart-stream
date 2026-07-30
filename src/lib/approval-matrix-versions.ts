import type { ApprovalRule, ApprovalRuleLevel, RuleCriterion, RuleDocType } from "@/hooks/useApprovalRules";

/** Regra congelada dentro de um snapshot de versão da matriz. */
export interface SnapshotRule {
  id: string;
  name: string;
  is_active: boolean;
  priority: number;
  doc_type: RuleDocType;
  criteria: RuleCriterion[];
  levels: { level_order: number; approver_name: string; approver_email: string | null }[];
}

export interface MatrixVersion {
  id: string;
  company_db: string;
  version_no: number;
  label: string | null;
  description: string | null;
  rules_count: number;
  levels_count: number;
  snapshot: SnapshotRule[];
  created_by: string | null;
  restored_from_version: number | null;
  created_at: string;
}

/** Converte as regras vivas em um snapshot determinístico (ordenado). */
export function buildSnapshot(rules: ApprovalRule[]): SnapshotRule[] {
  return [...rules]
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name))
    .map((r) => ({
      id: r.id,
      name: r.name,
      is_active: !!r.is_active,
      priority: r.priority || 0,
      doc_type: (r.doc_type || "both") as RuleDocType,
      criteria: Array.isArray(r.criteria) ? r.criteria : [],
      levels: [...(r.levels || [])]
        .sort((a, b) => a.level_order - b.level_order)
        .map((l: ApprovalRuleLevel) => ({
          level_order: l.level_order,
          approver_name: l.approver_name || "",
          approver_email: l.approver_email || null,
        })),
    }));
}

export function countLevels(snapshot: SnapshotRule[]): number {
  return snapshot.reduce((acc, r) => acc + (r.levels?.length || 0), 0);
}

export function describeRule(r: SnapshotRule): string {
  const crit = (r.criteria || [])
    .map((c) => `${c.field} ${c.operator} ${c.value}${c.value2 ? `..${c.value2}` : ""}`)
    .join(" | ");
  const lv = (r.levels || []).map((l) => `${l.level_order}:${l.approver_name}`).join(" → ");
  return `prio ${r.priority} · ${r.doc_type} · ${r.is_active ? "ativa" : "inativa"} · [${crit}] · ${lv}`;
}

export type DiffKind = "added" | "removed" | "changed" | "unchanged";

export interface RuleDiff {
  kind: DiffKind;
  name: string;
  id: string;
  before?: SnapshotRule;
  after?: SnapshotRule;
  fields: string[];
}

function keyOf(r: SnapshotRule) {
  return r.id || `name:${r.name.trim().toLowerCase()}`;
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Compara dois snapshots e devolve o diff regra a regra. */
export function diffSnapshots(before: SnapshotRule[], after: SnapshotRule[]): RuleDiff[] {
  const mapBefore = new Map(before.map((r) => [keyOf(r), r]));
  const mapAfter = new Map(after.map((r) => [keyOf(r), r]));
  const keys = Array.from(new Set([...mapBefore.keys(), ...mapAfter.keys()]));
  const out: RuleDiff[] = [];

  for (const k of keys) {
    const b = mapBefore.get(k);
    const a = mapAfter.get(k);
    if (b && !a) {
      out.push({ kind: "removed", name: b.name, id: b.id, before: b, fields: [] });
      continue;
    }
    if (!b && a) {
      out.push({ kind: "added", name: a.name, id: a.id, after: a, fields: [] });
      continue;
    }
    if (!b || !a) continue;
    const fields: string[] = [];
    if (b.name !== a.name) fields.push("Nome");
    if (b.is_active !== a.is_active) fields.push("Status");
    if ((b.priority || 0) !== (a.priority || 0)) fields.push("Prioridade");
    if ((b.doc_type || "both") !== (a.doc_type || "both")) fields.push("Tipo de documento");
    if (!eq(b.criteria, a.criteria)) fields.push("Critérios");
    if (!eq(b.levels, a.levels)) fields.push("Aprovadores");
    out.push({
      kind: fields.length ? "changed" : "unchanged",
      name: a.name,
      id: a.id,
      before: b,
      after: a,
      fields,
    });
  }

  const order: Record<DiffKind, number> = { added: 0, changed: 1, removed: 2, unchanged: 3 };
  return out.sort((x, y) => order[x.kind] - order[y.kind] || x.name.localeCompare(y.name));
}

export function summarizeDiff(diffs: RuleDiff[]) {
  return {
    added: diffs.filter((d) => d.kind === "added").length,
    removed: diffs.filter((d) => d.kind === "removed").length,
    changed: diffs.filter((d) => d.kind === "changed").length,
    unchanged: diffs.filter((d) => d.kind === "unchanged").length,
  };
}
