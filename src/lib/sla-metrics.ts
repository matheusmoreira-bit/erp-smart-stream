/**
 * Métricas de SLA de aprovação.
 *
 * Fonte: `expense_approval_log` (cada decisão) + `expenses` (documento).
 * O tempo de cada etapa é medido do momento em que o documento chegou ao
 * aprovador (envio ou decisão anterior) até a decisão dele, em HORAS ÚTEIS
 * (segunda a sexta), coerente com o escalonamento por SLA.
 */

export interface SlaLogRow {
  expense_id: string;
  approver_name: string | null;
  approver_email: string | null;
  decision: string;
  decided_at: string;
  level_order: number | null;
}

export interface SlaExpenseRow {
  id: string;
  cost_center: string | null;
  project: string | null;
  doc_type: string | null;
  total_amount: number | null;
  status: string | null;
  current_approver: string | null;
  created_at: string;
}

export interface SlaStep {
  expenseId: string;
  approver: string;
  costCenter: string;
  project: string;
  hours: number;
  decision: "approved" | "rejected";
  decidedAt: string;
  amount: number;
}

export interface SlaPending {
  expenseId: string;
  approver: string;
  costCenter: string;
  project: string;
  hours: number;
  since: string;
  amount: number;
  overdue: boolean;
}

const MS_HOUR = 3_600_000;

/** Horas úteis entre dois instantes (ignora sábado e domingo). */
export function businessHoursBetween(startIso: string | Date, endIso: string | Date): number {
  const start = startIso instanceof Date ? startIso : new Date(startIso);
  const end = endIso instanceof Date ? endIso : new Date(endIso);
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return 0;
  if (end <= start) return 0;

  let total = 0;
  let cursor = new Date(start);
  while (cursor < end) {
    const dayEnd = new Date(cursor);
    dayEnd.setHours(24, 0, 0, 0);
    const slice = Math.min(dayEnd.getTime(), end.getTime()) - cursor.getTime();
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) total += slice / MS_HOUR;
    cursor = new Date(Math.min(dayEnd.getTime(), end.getTime()));
    if (cursor.getTime() === end.getTime()) break;
  }
  return Number(total.toFixed(2));
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2));
}

function approverKey(l: SlaLogRow): string {
  return (l.approver_name || l.approver_email || "—").trim() || "—";
}

/** Reconstrói as etapas de aprovação concluídas a partir do log. */
export function buildSteps(expenses: SlaExpenseRow[], logs: SlaLogRow[]): SlaStep[] {
  const byExpense = new Map<string, SlaLogRow[]>();
  for (const l of logs) {
    const arr = byExpense.get(l.expense_id) || [];
    arr.push(l);
    byExpense.set(l.expense_id, arr);
  }

  const steps: SlaStep[] = [];
  for (const exp of expenses) {
    const arr = (byExpense.get(exp.id) || []).slice().sort(
      (a, b) => new Date(a.decided_at).getTime() - new Date(b.decided_at).getTime(),
    );
    if (arr.length === 0) continue;
    const submitted = arr.find((l) => l.decision === "submitted" || l.decision === "created");
    let ref = submitted?.decided_at || exp.created_at;
    for (const l of arr) {
      if (l.decision !== "approved" && l.decision !== "rejected") continue;
      steps.push({
        expenseId: exp.id,
        approver: approverKey(l),
        costCenter: exp.cost_center || "—",
        project: exp.project || "—",
        hours: businessHoursBetween(ref, l.decided_at),
        decision: l.decision,
        decidedAt: l.decided_at,
        amount: Number(exp.total_amount || 0),
      });
      ref = l.decided_at;
    }
  }
  return steps;
}

/** Documentos ainda pendentes: tempo em espera do aprovador atual. */
export function buildPending(
  expenses: SlaExpenseRow[],
  logs: SlaLogRow[],
  slaHours: number,
  now: Date = new Date(),
): SlaPending[] {
  const lastDecisionByExpense = new Map<string, string>();
  for (const l of logs) {
    if (l.decision !== "approved" && l.decision !== "submitted" && l.decision !== "created") continue;
    const prev = lastDecisionByExpense.get(l.expense_id);
    if (!prev || new Date(l.decided_at) > new Date(prev)) {
      lastDecisionByExpense.set(l.expense_id, l.decided_at);
    }
  }

  const out: SlaPending[] = [];
  for (const exp of expenses) {
    if (exp.status !== "pendente_aprovacao") continue;
    const since = lastDecisionByExpense.get(exp.id) || exp.created_at;
    const hours = businessHoursBetween(since, now);
    out.push({
      expenseId: exp.id,
      approver: (exp.current_approver || "—").trim() || "—",
      costCenter: exp.cost_center || "—",
      project: exp.project || "—",
      hours,
      since,
      amount: Number(exp.total_amount || 0),
      overdue: hours > slaHours,
    });
  }
  return out.sort((a, b) => b.hours - a.hours);
}

export interface SlaGroupStat {
  key: string;
  count: number;
  avgHours: number;
  p90Hours: number;
  maxHours: number;
  breached: number;
  breachPct: number;
  pending: number;
  pendingOverdue: number;
  amount: number;
}

function groupStats(
  steps: SlaStep[],
  pending: SlaPending[],
  slaHours: number,
  keyOf: (s: SlaStep) => string,
  pendingKeyOf: (p: SlaPending) => string,
): SlaGroupStat[] {
  const map = new Map<string, { hours: number[]; amount: number }>();
  for (const s of steps) {
    const k = keyOf(s);
    const e = map.get(k) || { hours: [], amount: 0 };
    e.hours.push(s.hours);
    e.amount += s.amount;
    map.set(k, e);
  }
  const pendMap = new Map<string, { total: number; overdue: number }>();
  for (const p of pending) {
    const k = pendingKeyOf(p);
    const e = pendMap.get(k) || { total: 0, overdue: 0 };
    e.total += 1;
    if (p.overdue) e.overdue += 1;
    pendMap.set(k, e);
    if (!map.has(k)) map.set(k, { hours: [], amount: 0 });
  }

  const out: SlaGroupStat[] = [];
  for (const [key, e] of map.entries()) {
    const breached = e.hours.filter((h) => h > slaHours).length;
    const pend = pendMap.get(key) || { total: 0, overdue: 0 };
    out.push({
      key,
      count: e.hours.length,
      avgHours: average(e.hours),
      p90Hours: percentile(e.hours, 90),
      maxHours: e.hours.length ? Number(Math.max(...e.hours).toFixed(2)) : 0,
      breached,
      breachPct: e.hours.length ? Math.round((breached / e.hours.length) * 100) : 0,
      pending: pend.total,
      pendingOverdue: pend.overdue,
      amount: Number(e.amount.toFixed(2)),
    });
  }
  return out.sort((a, b) => b.avgHours - a.avgHours || b.count - a.count);
}

export function statsByApprover(steps: SlaStep[], pending: SlaPending[], slaHours: number) {
  return groupStats(steps, pending, slaHours, (s) => s.approver, (p) => p.approver);
}
export function statsByCostCenter(steps: SlaStep[], pending: SlaPending[], slaHours: number) {
  return groupStats(steps, pending, slaHours, (s) => s.costCenter, (p) => p.costCenter);
}
export function statsByProject(steps: SlaStep[], pending: SlaPending[], slaHours: number) {
  return groupStats(steps, pending, slaHours, (s) => s.project, (p) => p.project);
}

export function slaStatsToCsv(rows: SlaGroupStat[], label: string): string {
  const head = [label, "Decisões", "Média (h úteis)", "P90 (h)", "Máx (h)", "Fora do SLA", "% fora", "Pendentes", "Pendentes atrasados"];
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.key, r.count, r.avgHours, r.p90Hours, r.maxHours, r.breached, `${r.breachPct}%`, r.pending, r.pendingOverdue]
      .map(esc)
      .join(","),
  );
  return [head.map(esc).join(","), ...lines].join("\n");
}
