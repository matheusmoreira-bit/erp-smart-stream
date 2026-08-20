/**
 * Circuit breaker por empresa (companyDB).
 *
 * Objetivo: quando uma base do ERP fica indisponível (timeouts, erros de rede,
 * 5xx sucessivos), paramos de chamá-la por alguns minutos. Assim uma base
 * travada não segura filas/telas que dependem de outras bases.
 *
 * Estados:
 *  - closed    → chamadas normais
 *  - open      → chamadas rejeitadas imediatamente (SapCircuitOpenError)
 *  - half-open → após o cooldown, permite UMA chamada de sondagem; se passar,
 *                fecha o circuito, se falhar, reabre com cooldown maior.
 *
 * Regras importantes:
 *  - Só falhas de INFRAESTRUTURA contam (timeout, rede, 5xx/408/429).
 *    Erros de negócio e sessão expirada NÃO abrem o circuito.
 *  - O escopo é por companyDB: uma base fora do ar não afeta as demais.
 */

export class SapCircuitOpenError extends Error {
  readonly companyDB: string;
  readonly retryAfterMs: number;

  constructor(companyDB: string, retryAfterMs: number) {
    const secs = Math.max(1, Math.ceil(retryAfterMs / 1000));
    super(
      `A base ${companyDB} está temporariamente indisponível. Novas tentativas serão liberadas em ~${secs}s.`,
    );
    this.name = "SapCircuitOpenError";
    this.companyDB = companyDB;
    this.retryAfterMs = retryAfterMs;
  }
}

export type CircuitState = "closed" | "open" | "half-open";

interface CircuitEntry {
  failures: number;
  firstFailureAt: number;
  openedAt: number | null;
  cooldownMs: number;
  probing: boolean;
  lastError?: string;
}

/** Falhas consecutivas de infra para abrir o circuito. */
const FAILURE_THRESHOLD = 4;
/** Janela em que as falhas são consideradas "consecutivas". */
const FAILURE_WINDOW_MS = 60_000;
/** Cooldown inicial com o circuito aberto. */
const BASE_COOLDOWN_MS = 2 * 60_000; // 2 min
/** Teto do cooldown quando a base continua fora do ar. */
const MAX_COOLDOWN_MS = 10 * 60_000; // 10 min

const circuits = new Map<string, CircuitEntry>();
const STORAGE_PREFIX = "erp:sap-circuit:";
const connectivityNotifiedAt = new Map<string, number>();
const CONNECTIVITY_NOTICE_THROTTLE_MS = 60_000;

function keyOf(companyDB: string | undefined | null): string {
  return (companyDB || "__global__").toUpperCase();
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function readPersisted(key: string): CircuitEntry | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CircuitEntry>;
    return {
      failures: Number(parsed.failures || 0),
      firstFailureAt: Number(parsed.firstFailureAt || 0),
      openedAt: parsed.openedAt == null ? null : Number(parsed.openedAt),
      cooldownMs: Number(parsed.cooldownMs || BASE_COOLDOWN_MS),
      probing: false,
      lastError: parsed.lastError,
    };
  } catch {
    return null;
  }
}

function persist(key: string, entry: CircuitEntry | null) {
  if (typeof localStorage === "undefined") return;
  try {
    if (!entry) localStorage.removeItem(storageKey(key));
    else localStorage.setItem(storageKey(key), JSON.stringify({ ...entry, probing: false }));
  } catch { /* storage is best-effort */ }
}

function getEntry(key: string): CircuitEntry {
  let entry = circuits.get(key);
  if (!entry) {
    entry = readPersisted(key) || {
      failures: 0,
      firstFailureAt: 0,
      openedAt: null,
      cooldownMs: BASE_COOLDOWN_MS,
      probing: false,
    };
    circuits.set(key, entry);
  }
  return entry;
}

function emitConnectivity(companyDB: string, available: boolean, reason?: string) {
  if (typeof window === "undefined") return;
  const key = keyOf(companyDB);
  if (!available) {
    const last = connectivityNotifiedAt.get(key) || 0;
    if (Date.now() - last < CONNECTIVITY_NOTICE_THROTTLE_MS) return;
    connectivityNotifiedAt.set(key, Date.now());
  } else {
    connectivityNotifiedAt.delete(key);
  }
  window.dispatchEvent(new CustomEvent("erp:sap-connectivity", {
    detail: { companyDB, available, reason },
  }));
}

function emit(companyDB: string, state: CircuitState, retryAfterMs = 0, reason?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("erp:circuit-breaker", { detail: { companyDB, state, retryAfterMs, reason } }),
  );
}

/** Estado atual do circuito de uma base. */
export function getCircuitState(companyDB: string | undefined | null): {
  state: CircuitState;
  retryAfterMs: number;
  lastError?: string;
} {
  const key = keyOf(companyDB);
  const entry = circuits.get(key) || readPersisted(key);
  if (entry && !circuits.has(key)) circuits.set(key, entry);
  if (!entry || entry.openedAt === null) {
    return { state: "closed", retryAfterMs: 0, lastError: entry?.lastError };
  }
  const elapsed = Date.now() - entry.openedAt;
  if (elapsed >= entry.cooldownMs) {
    return { state: "half-open", retryAfterMs: 0, lastError: entry.lastError };
  }
  return { state: "open", retryAfterMs: entry.cooldownMs - elapsed, lastError: entry.lastError };
}

/**
 * Chamado antes de disparar a requisição. Lança SapCircuitOpenError quando a
 * base está em cooldown. Em half-open, libera apenas uma sondagem por vez.
 */
export function assertCircuitClosed(companyDB: string | undefined | null): void {
  const key = keyOf(companyDB);
  const entry = circuits.get(key);
  if (!entry || entry.openedAt === null) return;

  const elapsed = Date.now() - entry.openedAt;
  if (elapsed < entry.cooldownMs) {
    throw new SapCircuitOpenError(companyDB || "ERP", entry.cooldownMs - elapsed);
  }

  // half-open: só uma sondagem simultânea
  if (entry.probing) {
    throw new SapCircuitOpenError(companyDB || "ERP", 5_000);
  }
  entry.probing = true;
  persist(key, entry);
}

/** Registra sucesso: fecha o circuito e zera o histórico. */
export function recordCircuitSuccess(companyDB: string | undefined | null): void {
  const key = keyOf(companyDB);
  const entry = circuits.get(key);
  if (!entry) return;
  const hadFailure = entry.failures > 0 || entry.openedAt !== null;
  circuits.delete(key);
  persist(key, null);
  if (hadFailure) {
    emit(companyDB || "ERP", "closed");
    emitConnectivity(companyDB || "ERP", true);
  }
}

/**
 * Registra uma falha de infraestrutura. Após FAILURE_THRESHOLD falhas dentro da
 * janela, abre o circuito (com cooldown exponencial se já estava aberto).
 */
export function recordCircuitFailure(companyDB: string | undefined | null, reason?: string): void {
  const key = keyOf(companyDB);
  const entry = getEntry(key);
  const now = Date.now();
  entry.lastError = reason;
  emitConnectivity(companyDB || "ERP", false, reason);

  // Falhou durante a sondagem half-open → reabre com cooldown maior.
  if (entry.probing) {
    entry.probing = false;
    entry.openedAt = now;
    entry.cooldownMs = Math.min(entry.cooldownMs * 2, MAX_COOLDOWN_MS);
    emit(companyDB || "ERP", "open", entry.cooldownMs, reason);
    persist(key, entry);
    return;
  }

  if (!entry.firstFailureAt || now - entry.firstFailureAt > FAILURE_WINDOW_MS) {
    entry.firstFailureAt = now;
    entry.failures = 0;
  }
  entry.failures += 1;

  if (entry.failures >= FAILURE_THRESHOLD && entry.openedAt === null) {
    entry.openedAt = now;
    entry.cooldownMs = BASE_COOLDOWN_MS;
    emit(companyDB || "ERP", "open", entry.cooldownMs, reason);
  }
  persist(key, entry);
}

/** Reset manual (ex.: novo login ou ação do usuário "tentar novamente"). */
export function resetCircuit(companyDB?: string | null): void {
  if (companyDB === undefined) {
    for (const key of circuits.keys()) persist(key, null);
    circuits.clear();
    if (typeof localStorage !== "undefined") {
      try {
        for (let index = localStorage.length - 1; index >= 0; index--) {
          const key = localStorage.key(index);
          if (key?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
        }
      } catch { /* storage is best-effort */ }
    }
    return;
  }
  const key = keyOf(companyDB);
  circuits.delete(key);
  persist(key, null);
  emit(companyDB || "ERP", "closed");
}

/** Snapshot para telas de diagnóstico/saúde das integrações. */
export function listCircuits(): Array<{ companyDB: string; state: CircuitState; retryAfterMs: number; lastError?: string }> {
  return Array.from(circuits.keys()).map((key) => ({
    companyDB: key,
    ...getCircuitState(key),
  }));
}
