// Motor determinístico de auditoria de pagamentos:
// compara o baseline (aprovação no ERP Flow ou Pedido de Compra SAP)
// com o settlement (fatura de compra + pagamento efetuado no SAP).

export type Severity = "conforme" | "baixa" | "media" | "alta" | "critica";

export type FindingType =
  | "desvio_valor"
  | "troca_fornecedor"
  | "troca_dados_bancarios"
  | "alteracao_itens"
  | "troca_centro_custo"
  | "troca_projeto"
  | "divergencia_solicitante"
  | "alteracao_pos_aprovacao"
  | "pagamento_sem_documento"
  | "pagamento_duplicado"
  | "pago_acima_aprovado";

export interface SnapshotLine {
  item_code: string | null;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  cost_center: string | null;
  project: string | null;
}

export interface Snapshot {
  source: string;
  document_ref: string | null;
  doc_date: string | null;
  fornecedor_code: string | null;
  fornecedor_name: string | null;
  valor: number | null;
  currency: string | null;
  cost_center: string | null;
  project: string | null;
  solicitante: string | null;
  aprovadores: string[];
  bank: { bank_code: string | null; branch: string | null; account: string | null; pix: string | null } | null;
  lines: SnapshotLine[];
  extra?: Record<string, unknown>;
}

export interface AuditConfig {
  tolerance_pct_baixa: number;
  tolerance_pct_media: number;
  approval_thresholds: unknown;
  fornecedor_risco: unknown;
  bank_change_window_days: number;
}

export const DEFAULT_CONFIG: AuditConfig = {
  tolerance_pct_baixa: 5,
  tolerance_pct_media: 15,
  approval_thresholds: [],
  fornecedor_risco: [],
  bank_change_window_days: 30,
};

export interface Finding {
  finding_type: FindingType;
  severity: Severity;
  field_name: string | null;
  value_before: unknown;
  value_after: unknown;
  delta: number | null;
  explanation: string;
}

const ORDER: Severity[] = ["conforme", "baixa", "media", "alta", "critica"];
export function maxSeverity(list: Severity[]): Severity {
  return list.reduce<Severity>((acc, s) => (ORDER.indexOf(s) > ORDER.indexOf(acc) ? s : acc), "conforme");
}

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bankKey(b: Snapshot["bank"]): string {
  if (!b) return "";
  return [b.bank_code, b.branch, b.account, b.pix].map(norm).join("|");
}

export function compareSnapshots(
  baseline: Snapshot,
  settlement: Snapshot,
  cfg: AuditConfig,
): { findings: Finding[]; desvioAbs: number; desvioPct: number } {
  const findings: Finding[] = [];

  // ---- Valor ----
  const vB = num(baseline.valor);
  const vS = num(settlement.valor);
  const desvioAbs = Number((vS - vB).toFixed(2));
  const desvioPct = vB !== 0 ? Number(((Math.abs(desvioAbs) / Math.abs(vB)) * 100).toFixed(4)) : (vS ? 100 : 0);

  if (Math.abs(desvioAbs) > 0.009) {
    let sev: Severity = "baixa";
    if (desvioPct > cfg.tolerance_pct_media) sev = "alta";
    else if (desvioPct > cfg.tolerance_pct_baixa) sev = "media";
    findings.push({
      finding_type: "desvio_valor",
      severity: sev,
      field_name: "valor",
      value_before: vB,
      value_after: vS,
      delta: desvioAbs,
      explanation: `Valor pago difere do aprovado em ${desvioAbs.toFixed(2)} (${desvioPct.toFixed(2)}%).`,
    });
  }

  // ---- Fornecedor (CardCode) ----
  const forncB = norm(baseline.fornecedor_code);
  const forncS = norm(settlement.fornecedor_code);
  const trocaFornecedor = !!forncB && !!forncS && forncB !== forncS;
  if (trocaFornecedor) {
    findings.push({
      finding_type: "troca_fornecedor",
      severity: "alta",
      field_name: "fornecedor_code",
      value_before: baseline.fornecedor_code,
      value_after: settlement.fornecedor_code,
      delta: null,
      explanation: `Fornecedor pago (${settlement.fornecedor_code} — ${settlement.fornecedor_name ?? "?"}) difere do aprovado (${baseline.fornecedor_code} — ${baseline.fornecedor_name ?? "?"}).`,
    });
  }

  // ---- Dados bancários ----
  const bB = bankKey(baseline.bank);
  const bS = bankKey(settlement.bank);
  const trocaBanco = !!bB && !!bS && bB !== bS;
  if (trocaBanco) {
    findings.push({
      finding_type: "troca_dados_bancarios",
      severity: "critica",
      field_name: "dados_bancarios",
      value_before: baseline.bank,
      value_after: settlement.bank,
      delta: null,
      explanation: "Dados bancários do beneficiário usados no pagamento diferem dos cadastrados na aprovação.",
    });
  }
  if (trocaBanco && trocaFornecedor) {
    findings.push({
      finding_type: "alteracao_pos_aprovacao",
      severity: "critica",
      field_name: "fornecedor+banco",
      value_before: { fornecedor: baseline.fornecedor_code, bank: baseline.bank },
      value_after: { fornecedor: settlement.fornecedor_code, bank: settlement.bank },
      delta: null,
      explanation: "Troca de fornecedor combinada com mudança de dados bancários entre a aprovação e o pagamento.",
    });
  }

  // ---- Centro de custo / projeto ----
  if (norm(baseline.cost_center) && norm(settlement.cost_center) && norm(baseline.cost_center) !== norm(settlement.cost_center)) {
    findings.push({
      finding_type: "troca_centro_custo",
      severity: "media",
      field_name: "cost_center",
      value_before: baseline.cost_center,
      value_after: settlement.cost_center,
      delta: null,
      explanation: `Centro de custo do pagamento (${settlement.cost_center}) difere do aprovado (${baseline.cost_center}).`,
    });
  }
  if (norm(baseline.project) && norm(settlement.project) && norm(baseline.project) !== norm(settlement.project)) {
    findings.push({
      finding_type: "troca_projeto",
      severity: "media",
      field_name: "project",
      value_before: baseline.project,
      value_after: settlement.project,
      delta: null,
      explanation: `Projeto do pagamento (${settlement.project}) difere do aprovado (${baseline.project}).`,
    });
  }

  // ---- Itens ----
  const mapB = new Map(baseline.lines.map((l) => [norm(l.item_code) || norm(l.description), l]));
  const mapS = new Map(settlement.lines.map((l) => [norm(l.item_code) || norm(l.description), l]));
  const added = [...mapS.keys()].filter((k) => k && !mapB.has(k));
  const removed = [...mapB.keys()].filter((k) => k && !mapS.has(k));
  const substituicao = added.length > 0 && removed.length > 0;

  for (const k of added) {
    findings.push({
      finding_type: "alteracao_itens",
      severity: substituicao ? "alta" : "media",
      field_name: "item_adicionado",
      value_before: null,
      value_after: mapS.get(k),
      delta: num(mapS.get(k)?.line_total),
      explanation: `Item ${mapS.get(k)?.item_code ?? k} presente no pagamento mas ausente na aprovação.`,
    });
  }
  for (const k of removed) {
    findings.push({
      finding_type: "alteracao_itens",
      severity: substituicao ? "alta" : "media",
      field_name: "item_removido",
      value_before: mapB.get(k),
      value_after: null,
      delta: num(mapB.get(k)?.line_total),
      explanation: `Item ${mapB.get(k)?.item_code ?? k} aprovado mas ausente no pagamento.`,
    });
  }
  for (const [k, lb] of mapB.entries()) {
    const ls = mapS.get(k);
    if (!k || !ls) continue;
    const dq = num(ls.quantity) - num(lb.quantity);
    const dp = num(ls.unit_price) - num(lb.unit_price);
    if (Math.abs(dq) > 0.0001 || Math.abs(dp) > 0.009) {
      findings.push({
        finding_type: "alteracao_itens",
        severity: "media",
        field_name: `item:${lb.item_code ?? k}`,
        value_before: { quantity: lb.quantity, unit_price: lb.unit_price },
        value_after: { quantity: ls.quantity, unit_price: ls.unit_price },
        delta: Number((num(ls.line_total) - num(lb.line_total)).toFixed(2)),
        explanation: `Quantidade/preço do item ${lb.item_code ?? k} mudou entre aprovação e pagamento.`,
      });
    }
  }

  // ---- Solicitante ----
  if (norm(baseline.solicitante) && norm(settlement.solicitante) && norm(baseline.solicitante) !== norm(settlement.solicitante)) {
    findings.push({
      finding_type: "divergencia_solicitante",
      severity: "alta",
      field_name: "solicitante",
      value_before: baseline.solicitante,
      value_after: settlement.solicitante,
      delta: null,
      explanation: "Solicitante registrado no pagamento não corresponde ao da aprovação.",
    });
  }

  // ---- Pagamento sem documento aprovado ----
  if (!baseline.document_ref && vS > 0) {
    findings.push({
      finding_type: "pagamento_sem_documento",
      severity: "critica",
      field_name: "baseline",
      value_before: null,
      value_after: settlement.document_ref,
      delta: vS,
      explanation: "Pagamento sem documento aprovado correspondente no ERP Flow / SAP.",
    });
  }

  // ---- Pago acima do aprovado, fora da alçada ----
  const thresholds = Array.isArray(cfg.approval_thresholds)
    ? (cfg.approval_thresholds as Array<{ limit?: number }>).map((t) => num(t?.limit)).filter((n) => n > 0).sort((a, b) => a - b)
    : [];
  const crossedBand = thresholds.some((t) => vB <= t && vS > t);
  if (desvioAbs > 0 && (desvioPct > cfg.tolerance_pct_media || crossedBand)) {
    findings.push({
      finding_type: "pago_acima_aprovado",
      severity: crossedBand ? "critica" : "alta",
      field_name: "valor",
      value_before: vB,
      value_after: vS,
      delta: desvioAbs,
      explanation: crossedBand
        ? "Valor pago ultrapassa a faixa de alçada em que o documento foi aprovado."
        : "Valor pago é significativamente maior que o valor aprovado.",
    });
  }

  return { findings, desvioAbs, desvioPct };
}

export function riskScore(findings: Finding[], desvioPct: number): number {
  const weight: Record<Severity, number> = { conforme: 0, baixa: 6, media: 15, alta: 30, critica: 50 };
  const base = findings.reduce((acc, f) => acc + weight[f.severity], 0);
  return Math.max(0, Math.min(100, Math.round(base + Math.min(desvioPct, 30) / 2)));
}
