// Helpers de casamento fiscal — reutilizados pelo motor de cruzamento
// (auditoria) e por qualquer adapter que precise comparar CNPJ, valor e data.
// A lógica é agnóstica de ERP: opera sobre valores primitivos já normalizados.

export interface MatchTolerance {
  toleranciaValorAbs: number;   // em R$
  toleranciaValorPct: number;   // fração, ex.: 0.005 = 0.5%
  janelaDias: number;           // ± dias corridos
  usarRaizCnpjFallback: boolean; // matriz/filial
}

export const DEFAULT_TOLERANCE: MatchTolerance = {
  toleranciaValorAbs: 1.0,
  toleranciaValorPct: 0.005,
  janelaDias: 10,
  usarRaizCnpjFallback: false,
};

export function normalizeCnpj(raw: string | null | undefined): string {
  return (raw || "").replace(/\D+/g, "");
}

export function cnpjRoot(digits: string): string {
  return digits.slice(0, 8);
}

export function cnpjEquals(a: string, b: string, usarRaiz: boolean): boolean {
  const A = normalizeCnpj(a);
  const B = normalizeCnpj(b);
  if (!A || !B) return false;
  if (A === B) return true;
  return usarRaiz && A.length >= 8 && B.length >= 8 && cnpjRoot(A) === cnpjRoot(B);
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const dA = a instanceof Date ? a : new Date(a);
  const dB = b instanceof Date ? b : new Date(b);
  return Math.round((dB.getTime() - dA.getTime()) / (1000 * 60 * 60 * 24));
}

export function valorDentroTolerancia(
  a: number,
  b: number,
  t: MatchTolerance,
): { ok: boolean; diff: number } {
  const diff = Math.abs(a - b);
  const pctBase = Math.max(Math.abs(a), Math.abs(b), 1);
  const limite = Math.max(t.toleranciaValorAbs, pctBase * t.toleranciaValorPct);
  return { ok: diff <= limite, diff };
}

export function dataDentroJanela(
  emissao: string,
  baixa: string,
  t: MatchTolerance,
): { ok: boolean; diff: number } {
  const diff = daysBetween(emissao, baixa);
  return { ok: Math.abs(diff) <= t.janelaDias, diff };
}

/** Calcula um score simples 0..1 (mais próximo em valor+data = maior). */
export function matchScore(diffValor: number, diffDias: number, t: MatchTolerance): number {
  const limiteValor = Math.max(t.toleranciaValorAbs, 1);
  const sV = Math.max(0, 1 - Math.min(diffValor / limiteValor, 1));
  const sD = Math.max(0, 1 - Math.min(Math.abs(diffDias) / Math.max(t.janelaDias, 1), 1));
  return Number(((sV * 0.6) + (sD * 0.4)).toFixed(4));
}
