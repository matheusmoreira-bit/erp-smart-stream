/**
 * Rateio de uma linha do pedido entre vários projetos.
 *
 * Regra de negócio: quando o rateio está habilitado numa linha, 100% do valor
 * da linha precisa estar distribuído entre os projetos selecionados para que o
 * lançamento possa ocorrer.
 */

export type ProjectSplitMode = "auto" | "manual";
export type ProjectSplitInputMode = "value" | "percent";

export interface ProjectSplitEntry {
  code: string;
  name: string;
  /** Valor alocado (moeda do documento). Usado quando o modo é manual. */
  amount: number;
}

export interface ProjectSplit {
  mode: ProjectSplitMode;
  inputMode: ProjectSplitInputMode;
  entries: ProjectSplitEntry[];
}

export const SPLIT_TOLERANCE = 0.01;

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Divide o total igualmente, jogando a sobra de centavos na última parcela. */
export function distributeEvenly(total: number, count: number): number[] {
  if (count <= 0) return [];
  const cents = Math.round((Number(total) || 0) * 100);
  const base = Math.trunc(cents / count);
  const rest = cents - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < rest ? 1 : 0)) / 100);
}

/** Valores efetivos por projeto, considerando o modo automático/manual. */
export function resolveSplitAmounts(split: ProjectSplit | null | undefined, total: number): ProjectSplitEntry[] {
  if (!split || split.entries.length === 0) return [];
  if (split.mode === "auto") {
    const parts = distributeEvenly(total, split.entries.length);
    return split.entries.map((e, i) => ({ ...e, amount: parts[i] }));
  }
  return split.entries.map((e) => ({ ...e, amount: roundMoney(e.amount) }));
}

export function sumSplit(split: ProjectSplit | null | undefined, total: number): number {
  return roundMoney(resolveSplitAmounts(split, total).reduce((s, e) => s + (Number(e.amount) || 0), 0));
}

export function isSplitEnabled(split: ProjectSplit | null | undefined): boolean {
  return !!split && split.entries.length > 0;
}

/** 100% do valor precisa estar rateado (tolerância de 1 centavo). */
export function isSplitComplete(split: ProjectSplit | null | undefined, total: number): boolean {
  if (!isSplitEnabled(split)) return false;
  const resolved = resolveSplitAmounts(split, total);
  if (resolved.some((e) => !e.code || !(Number(e.amount) > 0))) return false;
  return Math.abs(sumSplit(split, total) - roundMoney(total)) <= SPLIT_TOLERANCE;
}

export function splitRemaining(split: ProjectSplit | null | undefined, total: number): number {
  return roundMoney(roundMoney(total) - sumSplit(split, total));
}

export function percentOf(amount: number, total: number): number {
  if (!(Number(total) > 0)) return 0;
  return (Number(amount) || 0) / Number(total) * 100;
}

export function emptySplit(): ProjectSplit {
  return { mode: "auto", inputMode: "value", entries: [] };
}
