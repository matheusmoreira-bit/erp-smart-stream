// Invalidate pending local work on logout, including work in another tab.
const KEY = "erp-local-state-epoch";
let generation = 0;
export function localStateEpoch(): string {
  try { return `${generation}:${localStorage.getItem(KEY) || "0"}`; }
  catch { return String(generation); }
}
export function invalidateLocalState(): void {
  generation++;
  try { localStorage.setItem(KEY, crypto.randomUUID()); } catch { /* storage unavailable */ }
}
