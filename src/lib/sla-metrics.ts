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

// ---------------------------------------------------------------------------
// Tendência semanal (últimos 30/90 dias)
// ---------------------------------------------------------------------------

export interface SlaWeekPoint {
  /** Segunda-feira da semana (ISO date, yyyy-mm-dd). */
  weekStart: string;
  label: string;
  count: number;
  avgHours: number;
  p90Hours: number;
  withinPct: number;
  breached: number;
}

export interface SlaTrendDelta {
  metric: "avg" | "p90" | "within";
  label: string;
  current: number;
  baseline: number;
  diff: number;
  diffPct: number;
  worse: boolean;
}

export interface SlaTrend {
  points: SlaWeekPoint[];
  deltas: SlaTrendDelta[];
  worsening: boolean;
}

/** Segunda-feira da semana de uma data, em ISO yyyy-mm-dd (horário local). */
export function weekStartOf(date: string | Date): string {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=dom
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekLabel(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const f = (x: Date) => `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`;
  return `${f(start)}–${f(end)}`;
}

/**
 * Agrupa as decisões por semana e compara a última semana fechada de dados
 * com a média das semanas anteriores da janela, sinalizando piora.
 */
export function buildSlaTrend(
  steps: SlaStep[],
  slaHours: number,
  windowDays: number,
  now: Date = new Date(),
): SlaTrend {
  const cutoff = new Date(now.getTime() - windowDays * 24 * 3_600_000);
  const buckets = new Map<string, number[]>();
  for (const s of steps) {
    const decided = new Date(s.decidedAt);
    if (Number.isNaN(decided.getTime()) || decided < cutoff) continue;
    const wk = weekStartOf(decided);
    const arr = buckets.get(wk) || [];
    arr.push(s.hours);
    buckets.set(wk, arr);
  }

  const points: SlaWeekPoint[] = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekStart, hours]) => {
      const breached = hours.filter((h) => h > slaHours).length;
      return {
        weekStart,
        label: weekLabel(weekStart),
        count: hours.length,
        avgHours: average(hours),
        p90Hours: percentile(hours, 90),
        withinPct: hours.length ? Math.round(((hours.length - breached) / hours.length) * 100) : 0,
        breached,
      };
    });

  const deltas: SlaTrendDelta[] = [];
  if (points.length >= 2) {
    const current = points[points.length - 1];
    const prior = points.slice(0, -1);
    const base = (pick: (p: SlaWeekPoint) => number) => average(prior.map(pick));

    const mk = (
      metric: SlaTrendDelta["metric"],
      label: string,
      cur: number,
      baseline: number,
      higherIsWorse: boolean,
    ): SlaTrendDelta => {
      const diff = Number((cur - baseline).toFixed(2));
      const diffPct = baseline ? Math.round((diff / baseline) * 100) : 0;
      const worse = higherIsWorse ? diffPct >= 15 : diffPct <= -10;
      return { metric, label, current: cur, baseline, diff, diffPct, worse };
    };

    deltas.push(mk("avg", "Tempo médio", current.avgHours, base((p) => p.avgHours), true));
    deltas.push(mk("p90", "P90", current.p90Hours, base((p) => p.p90Hours), true));
    deltas.push(mk("within", "Dentro do SLA", current.withinPct, base((p) => p.withinPct), false));
  }

  return { points, deltas, worsening: deltas.some((d) => d.worse) };
}
