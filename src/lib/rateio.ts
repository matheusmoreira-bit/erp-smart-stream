import type { ApprovalDoc, DocumentLine } from "@/hooks/useApprovals";

/**
 * Modelos cujo nome começa com "ALL -" sempre acionam um único aprovador
 * para o documento inteiro, mesmo havendo rateio entre centros de custo.
 */
export function isAllApprovalModel(model?: string): boolean {
  return (model || "").trim().toUpperCase().startsWith("ALL -");
}

export interface CostCenterShare {
  code: string;
  amount: number;
  pct: number; // 0-100
}

export interface RateioInfo {
  isSplit: boolean;
  byCC: CostCenterShare[];
  total: number;
}

/**
 * Agrupa as linhas do documento por CostingCode e calcula o valor/percentual
 * de cada centro de custo. Considera rateio quando há 2+ centros distintos
 * (linhas sem CostingCode são ignoradas no agrupamento, mas somam no total).
 */
export function getRateioInfo(lines: DocumentLine[] | undefined): RateioInfo {
  const safe = Array.isArray(lines) ? lines : [];
  const total = safe.reduce((s, l) => s + Number(l.LineTotal || 0), 0);
  const map = new Map<string, number>();
  for (const l of safe) {
    const code = (l.CostingCode || "").trim();
    if (!code) continue;
    map.set(code, (map.get(code) || 0) + Number(l.LineTotal || 0));
  }
  const byCC: CostCenterShare[] = Array.from(map.entries())
    .map(([code, amount]) => ({
      code,
      amount,
      pct: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  return { isSplit: byCC.length >= 2, byCC, total };
}

/**
 * Combina detecção de rateio + regra "ALL -": só consideramos
 * que o card/modal deve mostrar layout de rateio quando há split
 * E o modelo não começa com "ALL -".
 */
export function shouldShowRateio(doc: ApprovalDoc): {
  show: boolean;
  info: RateioInfo;
} {
  const info = getRateioInfo(doc.documentLines);
  return { show: info.isSplit && !isAllApprovalModel(doc.approvalModel), info };
}

export function sumSelectedShare(
  info: RateioInfo,
  selectedCodes: Set<string>,
): number {
  return info.byCC
    .filter((cc) => selectedCodes.has(cc.code))
    .reduce((s, cc) => s + cc.amount, 0);
}
