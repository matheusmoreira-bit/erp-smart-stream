/**
 * Recomendações automáticas de redistribuição de aprovações.
 *
 * A partir das etapas concluídas (`SlaStep`) e da fila atual (`SlaPending`),
 * identifica aprovadores com GARGALO RECORRENTE — desempenho ruim repetido em
 * várias semanas, não um pico isolado — e sugere, para cada par
 * centro de custo × projeto sob responsabilidade dele, um aprovador alternativo
 * com histórico melhor e carga disponível.
 */

import {
  average,
  percentile,
  weekStartOf,
  type SlaPending,
  type SlaStep,
} from "@/lib/sla-metrics";

export interface ApproverProfile {
  approver: string;
  decisions: number;
  avgHours: number;
  p90Hours: number;
  breached: number;
  breachPct: number;
  weeks: number;
  badWeeks: number;
  pending: number;
  pendingOverdue: number;
  recurringBottleneck: boolean;
}

export interface RebalanceCandidate {
  approver: string;
  avgHours: number;
  breachPct: number;
  decisions: number;
  pending: number;
  /** Já decidiu documentos deste mesmo CC/projeto. */
  sameScope: boolean;
  score: number;
}

export interface RebalanceSuggestion {
  id: string;
  costCenter: string;
  project: string;
  currentApprover: string;
  decisions: number;
  avgHours: number;
  breachPct: number;
  pending: number;
  pendingOverdue: number;
  /** Horas úteis que deixariam de ser gastas por decisão, na média. */
  expectedGainHours: number;
  severity: "alta" | "média" | "baixa";
  reason: string;
  candidates: RebalanceCandidate[];
}

export interface RebalanceOptions {
  slaHours: number;
  /** Semanas ruins mínimas para considerar o gargalo recorrente. */
  minBadWeeks?: number;
  /** Decisões mínimas do aprovador na janela. */
  minDecisions?: number;
  /** Decisões mínimas no par CC×projeto para sugerir a troca. */
  minScopeDecisions?: number;
}

export interface RebalanceResult {
  profiles: ApproverProfile[];
  suggestions: RebalanceSuggestion[];
}

const scopeKey = (cc: string, project: string) => `${cc}||${project}`;

function pct(part: number, total: number) {
  return total ? Math.round((part / total) * 100) : 0;
}

/** Perfil de desempenho por aprovador, com detecção de recorrência semanal. */
export function buildApproverProfiles(
  steps: SlaStep[],
  pending: SlaPending[],
  slaHours: number,
  minBadWeeks = 2,
  minDecisions = 4,
): ApproverProfile[] {
  const byApprover = new Map<string, SlaStep[]>();
  for (const s of steps) {
    const arr = byApprover.get(s.approver) || [];
    arr.push(s);
    byApprover.set(s.approver, arr);
  }
  const pendByApprover = new Map<string, { total: number; overdue: number }>();
  for (const p of pending) {
    const e = pendByApprover.get(p.approver) || { total: 0, overdue: 0 };
    e.total += 1;
    if (p.overdue) e.overdue += 1;
    pendByApprover.set(p.approver, e);
  }

  const out: ApproverProfile[] = [];
  const allApprovers = new Set([...byApprover.keys(), ...pendByApprover.keys()]);
  for (const approver of allApprovers) {
    if (approver === "—") continue;
    const arr = byApprover.get(approver) || [];
    const hours = arr.map((s) => s.hours);
    const breached = hours.filter((h) => h > slaHours).length;

    const weekMap = new Map<string, number[]>();
    for (const s of arr) {
      const wk = weekStartOf(s.decidedAt);
      const w = weekMap.get(wk) || [];
      w.push(s.hours);
      weekMap.set(wk, w);
    }
    let badWeeks = 0;
    for (const w of weekMap.values()) {
      const wBreached = w.filter((h) => h > slaHours).length;
      if (w.length >= 2 && (average(w) > slaHours || wBreached / w.length > 0.3)) badWeeks += 1;
    }

    const pend = pendByApprover.get(approver) || { total: 0, overdue: 0 };
    out.push({
      approver,
      decisions: arr.length,
      avgHours: average(hours),
      p90Hours: percentile(hours, 90),
      breached,
      breachPct: pct(breached, hours.length),
      weeks: weekMap.size,
      badWeeks,
      pending: pend.total,
      pendingOverdue: pend.overdue,
      recurringBottleneck:
        (arr.length >= minDecisions && badWeeks >= minBadWeeks) ||
        (pend.overdue >= 3 && arr.length >= minDecisions && average(hours) > slaHours),
    });
  }
  return out.sort((a, b) => b.avgHours - a.avgHours);
}

/**
 * Gera as recomendações de redistribuição.
 * Só sugere troca quando existe candidato com desempenho materialmente melhor
 * (pelo menos 25% mais rápido) no mesmo escopo ou em escopo comparável.
 */
export function buildRebalanceSuggestions(
  steps: SlaStep[],
  pending: SlaPending[],
  opts: RebalanceOptions,
): RebalanceResult {
  const {
    slaHours,
    minBadWeeks = 2,
    minDecisions = 4,
    minScopeDecisions = 2,
  } = opts;

  const profiles = buildApproverProfiles(steps, pending, slaHours, minBadWeeks, minDecisions);
  const profileByName = new Map(profiles.map((p) => [p.approver, p]));
  const bottlenecks = profiles.filter((p) => p.recurringBottleneck);
  if (bottlenecks.length === 0) return { profiles, suggestions: [] };

  // escopo (cc × projeto) → aprovador → etapas
  const scopeMap = new Map<string, Map<string, SlaStep[]>>();
  for (const s of steps) {
    const k = scopeKey(s.costCenter, s.project);
    const inner = scopeMap.get(k) || new Map<string, SlaStep[]>();
    const arr = inner.get(s.approver) || [];
    arr.push(s);
    inner.set(s.approver, arr);
    scopeMap.set(k, inner);
  }
  const pendingByScopeApprover = new Map<string, { total: number; overdue: number }>();
  for (const p of pending) {
    const k = `${scopeKey(p.costCenter, p.project)}||${p.approver}`;
    const e = pendingByScopeApprover.get(k) || { total: 0, overdue: 0 };
    e.total += 1;
    if (p.overdue) e.overdue += 1;
    pendingByScopeApprover.set(k, e);
  }

  const medianPending = (() => {
    const vals = profiles.map((p) => p.pending).sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  })();

  const suggestions: RebalanceSuggestion[] = [];

  for (const bad of bottlenecks) {
    for (const [scope, byApprover] of scopeMap.entries()) {
      const own = byApprover.get(bad.approver);
      if (!own || own.length < minScopeDecisions) continue;

      const [costCenter, project] = scope.split("||");
      const hours = own.map((s) => s.hours);
      const avgHours = average(hours);
      const breached = hours.filter((h) => h > slaHours).length;
      const breachPct = pct(breached, hours.length);
      if (avgHours <= slaHours && breachPct < 30) continue;

      const pend = pendingByScopeApprover.get(`${scope}||${bad.approver}`) || { total: 0, overdue: 0 };

      const candidates: RebalanceCandidate[] = [];
      for (const p of profiles) {
        if (p.approver === bad.approver || p.recurringBottleneck) continue;
        if (p.decisions < minDecisions) continue;
        if (p.avgHours > avgHours * 0.75) continue; // precisa ser bem melhor
        if (p.avgHours > slaHours) continue;
        const sameScope = (byApprover.get(p.approver)?.length || 0) > 0;
        const loadPenalty = medianPending > 0 ? Math.max(0, p.pending - medianPending) * 2 : p.pending;
        const score = Number(
          (
            (avgHours - p.avgHours) * 3 +
            (breachPct - p.breachPct) * 0.5 +
            (sameScope ? 25 : 0) -
            loadPenalty -
            p.pendingOverdue * 5
          ).toFixed(2),
        );
        candidates.push({
          approver: p.approver,
          avgHours: p.avgHours,
          breachPct: p.breachPct,
          decisions: p.decisions,
          pending: p.pending,
          sameScope,
          score,
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      const top = candidates.slice(0, 3);
      if (top.length === 0) continue;

      const expectedGainHours = Number((avgHours - top[0].avgHours).toFixed(1));
      const severity: RebalanceSuggestion["severity"] =
        pend.overdue >= 2 || avgHours > slaHours * 2
          ? "alta"
          : avgHours > slaHours || breachPct >= 50
            ? "média"
            : "baixa";

      const badProfile = profileByName.get(bad.approver);
      suggestions.push({
        id: `${scope}||${bad.approver}`,
        costCenter,
        project,
        currentApprover: bad.approver,
        decisions: own.length,
        avgHours,
        breachPct,
        pending: pend.total,
        pendingOverdue: pend.overdue,
        expectedGainHours,
        severity,
        reason:
          `Gargalo recorrente: ${badProfile?.badWeeks ?? 0} de ${badProfile?.weeks ?? 0} semanas acima do SLA` +
          (pend.overdue > 0 ? ` e ${pend.overdue} pendente(s) atrasado(s) neste escopo` : "") +
          `. Média de ${avgHours.toFixed(1)}h úteis contra SLA de ${slaHours}h.`,
        candidates: top,
      });
    }
  }

  const rank = { alta: 0, média: 1, baixa: 2 } as const;
  suggestions.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.expectedGainHours - a.expectedGainHours,
  );
  return { profiles, suggestions };
}

export function rebalanceToCsv(rows: RebalanceSuggestion[]): string {
  const head = [
    "Centro de custo",
    "Projeto",
    "Aprovador atual",
    "Decisões",
    "Média (h úteis)",
    "% fora do SLA",
    "Pendentes",
    "Pendentes atrasados",
    "Severidade",
    "Ganho estimado (h)",
    "Sugestão 1",
    "Sugestão 2",
    "Sugestão 3",
    "Motivo",
  ];
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.costCenter,
      r.project,
      r.currentApprover,
      r.decisions,
      r.avgHours,
      `${r.breachPct}%`,
      r.pending,
      r.pendingOverdue,
      r.severity,
      r.expectedGainHours,
      r.candidates[0] ? `${r.candidates[0].approver} (${r.candidates[0].avgHours}h)` : "",
      r.candidates[1] ? `${r.candidates[1].approver} (${r.candidates[1].avgHours}h)` : "",
      r.candidates[2] ? `${r.candidates[2].approver} (${r.candidates[2].avgHours}h)` : "",
      r.reason,
    ]
      .map(esc)
      .join(","),
  );
  return [head.map(esc).join(","), ...lines].join("\n");
}
