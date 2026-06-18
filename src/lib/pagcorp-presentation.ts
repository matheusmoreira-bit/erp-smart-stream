import PptxGenJS from "pptxgenjs";
import type { PagCorpTransaction } from "@/hooks/usePagCorp";

export type PresentationPeriod = "monthly" | "quarterly" | "semestral" | "custom";

const PERIOD_LABEL: Record<PresentationPeriod, string> = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  semestral: "Semestral",
  custom: "Personalizado",
};

const PERIOD_MONTHS: Record<PresentationPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  semestral: 6,
  custom: 0,
};

// Brand-ish palette aligned to the reference deck
const COLORS = {
  bg: "0B0B0B",
  white: "FFFFFF",
  muted: "B5B5B5",
  accent: "00C2FF",
  brl: "29C46F",
  usd: "2E7CF6",
  warn: "F4B400",
  red: "E14B4B",
  cardBg: "1A1A1A",
  divider: "262626",
};

export interface PresentationInput {
  companyLabel: string;
  companyDb: string;
  period: PresentationPeriod;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  transactions: PagCorpTransaction[];
  /** Optional account → cost center mapping (from pagcorp_account_mapping) */
  costCenterMap?: Record<string, { costCenter?: string | null; accountName?: string | null }>;
}

function fmtMoney(value: number, currency: string = "BRL"): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return value.toFixed(0);
  }
}

function fmtDateBr(s: string): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("pt-BR");
  } catch {
    return s;
  }
}

interface Bucket {
  label: string;
  amount: number;
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item) || "—";
    const list = out.get(k) ?? [];
    list.push(item);
    out.set(k, list);
  }
  return out;
}

function sortByAmountDesc(rows: Bucket[]): Bucket[] {
  return [...rows].sort((a, b) => b.amount - a.amount);
}

/** Build a dark slide master and a few helpers */
function addMaster(pptx: PptxGenJS) {
  pptx.defineSlideMaster({
    title: "DARK",
    background: { color: COLORS.bg },
    objects: [
      {
        rect: {
          x: 0,
          y: 7.2,
          w: 13.333,
          h: 0.3,
          fill: { color: COLORS.divider },
          line: { type: "none" },
        },
      },
    ],
  });
}

function addSectionHeader(slide: PptxGenJS.Slide, title: string, page: number | string) {
  slide.addText(title, {
    x: 0.4,
    y: 0.3,
    w: 11.5,
    h: 0.5,
    fontFace: "Calibri",
    fontSize: 22,
    bold: true,
    color: COLORS.white,
  });
  slide.addText(String(page), {
    x: 12.4,
    y: 0.3,
    w: 0.6,
    h: 0.5,
    fontFace: "Calibri",
    fontSize: 16,
    color: COLORS.muted,
    align: "right",
  });
}

function addKpi(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  label: string,
  value: string,
  sub?: string,
  color: string = COLORS.white,
) {
  slide.addShape("roundRect", {
    x,
    y,
    w: 2.9,
    h: 1.4,
    fill: { color: COLORS.cardBg },
    line: { color: COLORS.divider, width: 0.5 },
    rectRadius: 0.08,
  });
  slide.addText(label, {
    x: x + 0.15,
    y: y + 0.1,
    w: 2.6,
    h: 0.3,
    fontFace: "Calibri",
    fontSize: 10,
    color: COLORS.muted,
    bold: true,
  });
  slide.addText(value, {
    x: x + 0.15,
    y: y + 0.4,
    w: 2.6,
    h: 0.55,
    fontFace: "Calibri",
    fontSize: 22,
    bold: true,
    color,
  });
  if (sub) {
    slide.addText(sub, {
      x: x + 0.15,
      y: y + 0.95,
      w: 2.6,
      h: 0.35,
      fontFace: "Calibri",
      fontSize: 9,
      color: COLORS.muted,
    });
  }
}

function buildCover(
  pptx: PptxGenJS,
  input: PresentationInput,
) {
  const s = pptx.addSlide({ masterName: "DARK" });
  s.addText(input.companyLabel, {
    x: 0.6,
    y: 2.0,
    w: 12,
    h: 0.6,
    fontFace: "Calibri",
    fontSize: 18,
    color: COLORS.accent,
    bold: true,
  });
  s.addText("Relatório de Despesas — Cartão Crédito", {
    x: 0.6,
    y: 2.7,
    w: 12,
    h: 1.0,
    fontFace: "Calibri",
    fontSize: 36,
    color: COLORS.white,
    bold: true,
  });
  s.addText(`${PERIOD_LABEL[input.period]}  |  ${fmtDateBr(input.startDate)} → ${fmtDateBr(input.endDate)}`, {
    x: 0.6,
    y: 3.8,
    w: 12,
    h: 0.5,
    fontFace: "Calibri",
    fontSize: 18,
    color: COLORS.muted,
  });
  s.addText("Gerado automaticamente — fonte: PagCorp", {
    x: 0.6,
    y: 6.5,
    w: 12,
    h: 0.4,
    fontFace: "Calibri",
    fontSize: 10,
    color: COLORS.muted,
    italic: true,
  });
}

function totalsByCurrency(txs: PagCorpTransaction[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txs) {
    const c = (t.currency || "BRL").toUpperCase();
    out[c] = (out[c] || 0) + (Number(t.amount) || 0);
  }
  return out;
}

function buildExecutiveSummary(pptx: PptxGenJS, input: PresentationInput) {
  const s = pptx.addSlide({ masterName: "DARK" });
  addSectionHeader(s, "RESUMO EXECUTIVO", "02");

  const totals = totalsByCurrency(input.transactions);
  const brl = totals["BRL"] || 0;
  const usd = totals["USD"] || 0;
  const count = input.transactions.length;
  const withAcc = input.transactions.filter((t) => t.hasAccountability).length;
  const integrated = input.transactions.filter((t) => t.integrated).length;

  addKpi(s, 0.4, 1.1, "DESPESA TOTAL R$", fmtMoney(brl, "BRL"), `${PERIOD_LABEL[input.period]}`, COLORS.brl);
  addKpi(s, 3.5, 1.1, "DESPESA TOTAL US$", fmtMoney(usd, "USD"), "Pagamentos em dólar", COLORS.usd);
  addKpi(s, 6.6, 1.1, "TRANSAÇÕES", String(count), `${withAcc} com prestação`, COLORS.white);
  addKpi(s, 9.7, 1.1, "INTEGRADAS NO SAP", `${integrated}/${count}`, `${count - integrated} pendentes`, COLORS.accent);

  // Top despesas por descrição (top 10)
  const byDesc = new Map<string, { brl: number; usd: number }>();
  for (const t of input.transactions) {
    const key = (t.description || "—").trim().slice(0, 48) || "—";
    const cur = (t.currency || "BRL").toUpperCase();
    const cur2 = cur === "USD" ? "usd" : "brl";
    const r = byDesc.get(key) ?? { brl: 0, usd: 0 };
    r[cur2] += Number(t.amount) || 0;
    byDesc.set(key, r);
  }
  const top = [...byDesc.entries()]
    .map(([label, v]) => ({ label, total: v.brl + v.usd * 5, brl: v.brl, usd: v.usd }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  s.addText("Top despesas no período", {
    x: 0.4,
    y: 2.8,
    w: 6,
    h: 0.4,
    fontFace: "Calibri",
    fontSize: 13,
    bold: true,
    color: COLORS.white,
  });

  const tableRows: PptxGenJS.TableRow[] = [
    [
      { text: "Descrição", options: { bold: true, color: COLORS.muted, fontSize: 9 } },
      { text: "R$", options: { bold: true, color: COLORS.muted, fontSize: 9, align: "right" } },
      { text: "US$", options: { bold: true, color: COLORS.muted, fontSize: 9, align: "right" } },
    ],
    ...top.map<PptxGenJS.TableRow>((r) => [
      { text: r.label, options: { color: COLORS.white, fontSize: 9 } },
      { text: r.brl ? fmtMoney(r.brl, "BRL") : "—", options: { color: COLORS.white, fontSize: 9, align: "right" } },
      { text: r.usd ? fmtMoney(r.usd, "USD") : "—", options: { color: COLORS.white, fontSize: 9, align: "right" } },
    ]),
  ];

  s.addTable(tableRows, {
    x: 0.4,
    y: 3.25,
    w: 8.5,
    colW: [5.5, 1.5, 1.5],
    fontFace: "Calibri",
    border: { type: "solid", color: COLORS.divider, pt: 0.5 },
    fill: { color: COLORS.cardBg },
  });

  // Mini chart: total por moeda
  const dataChart = [
    {
      name: "Despesa por moeda",
      labels: Object.keys(totals),
      values: Object.values(totals),
    },
  ];
  s.addChart("doughnut", dataChart, {
    x: 9.3,
    y: 3.0,
    w: 3.6,
    h: 3.0,
    chartColors: [COLORS.brl, COLORS.usd, COLORS.warn, COLORS.accent],
    showLegend: true,
    legendPos: "b",
    legendColor: COLORS.muted,
    legendFontSize: 9,
    dataLabelColor: COLORS.white,
    dataLabelFontSize: 9,
  });
}

function buildByCostCenter(
  pptx: PptxGenJS,
  input: PresentationInput,
  currency: "BRL" | "USD",
  page: string,
) {
  const filtered = input.transactions.filter(
    (t) => (t.currency || "BRL").toUpperCase() === currency,
  );
  if (filtered.length === 0) return;

  const s = pptx.addSlide({ masterName: "DARK" });
  addSectionHeader(s, `CENTRO DE CUSTO — ${currency === "BRL" ? "R$" : "US$"}`, page);

  const groups = new Map<string, number>();
  for (const t of filtered) {
    const map = input.costCenterMap?.[t.accountCode || ""];
    const cc = map?.costCenter || map?.accountName || t.accountName || t.accountCode || "—";
    groups.set(cc, (groups.get(cc) || 0) + (Number(t.amount) || 0));
  }
  const rows: Bucket[] = sortByAmountDesc(
    [...groups.entries()].map(([label, amount]) => ({ label, amount })),
  );
  const total = rows.reduce((a, b) => a + b.amount, 0);

  // Top 4 KPI cards
  const top4 = rows.slice(0, 4);
  top4.forEach((r, i) => {
    addKpi(
      s,
      0.4 + i * 3.1,
      1.1,
      r.label.toUpperCase().slice(0, 24),
      fmtMoney(r.amount, currency),
      total ? `${((r.amount / total) * 100).toFixed(0)}% do total` : undefined,
      currency === "BRL" ? COLORS.brl : COLORS.usd,
    );
  });

  // Bar chart
  s.addChart(
    "bar",
    [
      {
        name: `Centro de Custo (${currency})`,
        labels: rows.slice(0, 10).map((r) => r.label),
        values: rows.slice(0, 10).map((r) => r.amount),
      },
    ],
    {
      x: 0.4,
      y: 2.8,
      w: 12.5,
      h: 4.0,
      barDir: "bar",
      chartColors: [currency === "BRL" ? COLORS.brl : COLORS.usd],
      catAxisLabelColor: COLORS.white,
      catAxisLabelFontSize: 10,
      valAxisLabelColor: COLORS.muted,
      valAxisLabelFontSize: 9,
      showValue: true,
      dataLabelColor: COLORS.white,
      dataLabelFontSize: 9,
      showLegend: false,
    },
  );
}

function buildMonthlyEvolution(pptx: PptxGenJS, input: PresentationInput) {
  if (input.period === "monthly") return; // not relevant for single month
  if (input.period === "custom") {
    const ms = new Date(input.endDate).getTime() - new Date(input.startDate).getTime();
    if (ms < 1000 * 60 * 60 * 24 * 45) return; // <45 dias: pular evolução mensal
  }

  const monthKey = (d: string) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  };
  const byMonth = new Map<string, { brl: number; usd: number }>();
  for (const t of input.transactions) {
    if (!t.date) continue;
    const k = monthKey(t.date);
    const r = byMonth.get(k) ?? { brl: 0, usd: 0 };
    const cur = (t.currency || "BRL").toUpperCase();
    if (cur === "USD") r.usd += Number(t.amount) || 0;
    else r.brl += Number(t.amount) || 0;
    byMonth.set(k, r);
  }
  const labels = [...byMonth.keys()].sort();
  if (labels.length === 0) return;

  const s = pptx.addSlide({ masterName: "DARK" });
  addSectionHeader(s, "EVOLUÇÃO MENSAL", "03");

  s.addChart(
    "bar",
    [
      {
        name: "R$",
        labels,
        values: labels.map((l) => byMonth.get(l)!.brl),
      },
      {
        name: "US$",
        labels,
        values: labels.map((l) => byMonth.get(l)!.usd),
      },
    ],
    {
      x: 0.4,
      y: 1.2,
      w: 12.5,
      h: 5.6,
      barDir: "col",
      barGrouping: "clustered",
      chartColors: [COLORS.brl, COLORS.usd],
      catAxisLabelColor: COLORS.white,
      catAxisLabelFontSize: 11,
      valAxisLabelColor: COLORS.muted,
      valAxisLabelFontSize: 9,
      showLegend: true,
      legendPos: "b",
      legendColor: COLORS.muted,
      showValue: true,
      dataLabelColor: COLORS.white,
      dataLabelFontSize: 8,
    },
  );
}

function buildByCard(pptx: PptxGenJS, input: PresentationInput) {
  const byCard = new Map<string, { brl: number; usd: number; count: number }>();
  for (const t of input.transactions) {
    const key = `${t.accountAlias || t.accountName || "—"}${t.cardLastDigits ? ` •••${t.cardLastDigits}` : ""}`;
    const r = byCard.get(key) ?? { brl: 0, usd: 0, count: 0 };
    const cur = (t.currency || "BRL").toUpperCase();
    if (cur === "USD") r.usd += Number(t.amount) || 0;
    else r.brl += Number(t.amount) || 0;
    r.count += 1;
    byCard.set(key, r);
  }
  const rows = [...byCard.entries()]
    .map(([label, v]) => ({ label, ...v, total: v.brl + v.usd * 5 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
  if (rows.length === 0) return;

  const s = pptx.addSlide({ masterName: "DARK" });
  addSectionHeader(s, "POR CARTÃO / PORTADOR", "04");

  const tableRows: PptxGenJS.TableRow[] = [
    [
      { text: "Portador", options: { bold: true, color: COLORS.muted, fontSize: 10 } },
      { text: "Transações", options: { bold: true, color: COLORS.muted, fontSize: 10, align: "right" } },
      { text: "R$", options: { bold: true, color: COLORS.muted, fontSize: 10, align: "right" } },
      { text: "US$", options: { bold: true, color: COLORS.muted, fontSize: 10, align: "right" } },
    ],
    ...rows.map<PptxGenJS.TableRow>((r) => [
      { text: r.label, options: { color: COLORS.white, fontSize: 10 } },
      { text: String(r.count), options: { color: COLORS.white, fontSize: 10, align: "right" } },
      { text: r.brl ? fmtMoney(r.brl, "BRL") : "—", options: { color: COLORS.brl, fontSize: 10, align: "right" } },
      { text: r.usd ? fmtMoney(r.usd, "USD") : "—", options: { color: COLORS.usd, fontSize: 10, align: "right" } },
    ]),
  ];

  s.addTable(tableRows, {
    x: 0.4,
    y: 1.2,
    w: 12.5,
    colW: [6.5, 2, 2, 2],
    fontFace: "Calibri",
    border: { type: "solid", color: COLORS.divider, pt: 0.5 },
    fill: { color: COLORS.cardBg },
  });
}

function buildNextSteps(pptx: PptxGenJS, input: PresentationInput) {
  const s = pptx.addSlide({ masterName: "DARK" });
  addSectionHeader(s, "PRÓXIMOS PASSOS", "99");

  const pending = input.transactions.filter((t) => !t.integrated).length;
  const noAccountability = input.transactions.filter((t) => !t.hasAccountability).length;

  const bullets = [
    `Integrar ${pending} transação(ões) ainda não enviadas ao SAP.`,
    `${noAccountability} transação(ões) sem prestação de conta — solicitar comprovantes.`,
    `Consolidar fornecedores recorrentes em 1 PC por mês quando aplicável.`,
    `Revisar mapeamento de centro de custo para contas PagCorp sem classificação.`,
  ];

  s.addText(
    bullets.map((b) => ({ text: b, options: { bullet: { code: "25CF" }, color: COLORS.white, fontSize: 14 } })),
    {
      x: 0.6,
      y: 1.5,
      w: 12,
      h: 4,
      fontFace: "Calibri",
      paraSpaceAfter: 12,
    },
  );
}

export async function generatePagCorpPresentation(input: PresentationInput): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
  pptx.author = "ERP Smart Stream";
  pptx.company = input.companyLabel;
  pptx.title = `Despesas Cartão Crédito - ${input.companyLabel} - ${PERIOD_LABEL[input.period]}`;

  addMaster(pptx);

  // Each builder isolated so a single failure doesn't kill the whole .pptx
  const stages: { name: string; fn: () => void }[] = [
    { name: "cover", fn: () => buildCover(pptx, input) },
    { name: "summary", fn: () => buildExecutiveSummary(pptx, input) },
    { name: "cc-brl", fn: () => buildByCostCenter(pptx, input, "BRL", "03") },
    { name: "cc-usd", fn: () => buildByCostCenter(pptx, input, "USD", "04") },
    { name: "monthly", fn: () => buildMonthlyEvolution(pptx, input) },
    { name: "by-card", fn: () => buildByCard(pptx, input) },
    { name: "next", fn: () => buildNextSteps(pptx, input) },
  ];
  const failed: string[] = [];
  for (const s of stages) {
    try { s.fn(); } catch (e) {
      console.error(`[pptx] stage ${s.name} failed:`, e);
      failed.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed.length === stages.length) {
    throw new Error(`Falha ao montar slides: ${failed.join(" | ")}`);
  }

  const safeName = input.companyLabel.replace(/[^a-z0-9\-_]+/gi, "_");
  const fileName = `PagCorp_${safeName}_${PERIOD_LABEL[input.period]}_${input.endDate}.pptx`;
  try {
    await pptx.writeFile({ fileName });
  } catch (e) {
    throw new Error(`Falha ao salvar .pptx: ${e instanceof Error ? e.message : String(e)}`);
  }
}
