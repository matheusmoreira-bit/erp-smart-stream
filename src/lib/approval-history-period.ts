// Períodos do Histórico de Aprovações, sempre no fuso America/Sao_Paulo
// (UTC-03:00 fixo desde o fim do horário de verão em 2019).
export type HistoryPeriod = "30d" | "6m" | "ytd" | "custom" | "all";
export const HISTORY_PERIODS: HistoryPeriod[] = ["30d", "6m", "ytd", "custom", "all"];
export const PERIOD_LABELS: Record<HistoryPeriod, string> = {
  "30d": "Último mês (30 dias)",
  "6m": "Últimos 6 meses",
  ytd: "Este ano",
  custom: "Personalizado",
  all: "Todo o período",
};

const SP_OFFSET = "-03:00";
const isYmd = (v?: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Data (AAAA-MM-DD) "hoje" em São Paulo. */
export function spToday(now: Date = new Date()): string {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Intervalo inclusivo em ISO UTC; null = sem limite. */
export function periodRange(
  period: HistoryPeriod,
  custom: { from?: string | null; to?: string | null } = {},
  now: Date = new Date(),
): { from: string | null; to: string | null } {
  const today = spToday(now);
  const start = (ymd: string) => new Date(`${ymd}T00:00:00.000${SP_OFFSET}`).toISOString();
  const end = (ymd: string) => new Date(`${ymd}T23:59:59.999${SP_OFFSET}`).toISOString();
  const minus = (days: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() - days * 86400_000).toISOString().slice(0, 10);
  switch (period) {
    case "30d": return { from: start(minus(30)), to: end(today) };
    case "6m": {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 6);
      return { from: start(d.toISOString().slice(0, 10)), to: end(today) };
    }
    case "ytd": return { from: start(`${today.slice(0, 4)}-01-01`), to: end(today) };
    case "custom": return {
      from: isYmd(custom.from) ? start(custom.from!) : null,
      to: isYmd(custom.to) ? end(custom.to!) : null,
    };
    default: return { from: null, to: null };
  }
}

export function periodLabel(period: HistoryPeriod, custom: { from?: string | null; to?: string | null } = {}): string {
  if (period !== "custom") return PERIOD_LABELS[period];
  const br = (v?: string | null) => (isYmd(v) ? v!.split("-").reverse().join("/") : "…");
  return `${br(custom.from)} a ${br(custom.to)}`;
}

export interface DecisionSummary { total: number; approved: number; rejected: number; byCurrency: Record<string, number> }
export function summarizeDecisions(rows: Array<{ decision: string | null; doc_total: number | null; currency: string | null }>): DecisionSummary {
  const s: DecisionSummary = { total: 0, approved: 0, rejected: 0, byCurrency: {} };
  for (const r of rows) {
    if (r.decision !== "Y" && r.decision !== "N") continue;
    s.total++;
    if (r.decision === "Y") s.approved++; else s.rejected++;
    const c = r.currency || "BRL";
    s.byCurrency[c] = (s.byCurrency[c] || 0) + Number(r.doc_total || 0);
  }
  return s;
}
