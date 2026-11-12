// Disjuntor (circuit breaker) da HanaAPI V2.
//
// Quando o servidor HANA está sem comunicação de rede, cada consulta esperava
// o timeout inteiro (~30 s) antes de falhar, encadeando esperas até estourar o
// limite de 150 s das funções (tela em branco em Usuários, aprovações etc.).
// Com o disjuntor aberto, a consulta falha em milissegundos com mensagem clara
// e as rotinas que têm alternativa (Service Layer) seguem imediatamente.
//
// Não altera endereço, TLS, credenciais nem permissões: apenas evita repetir
// tentativas que comprovadamente não chegam ao servidor. A sonda
// hana-health-probe continua testando de forma independente e, ao primeiro
// sucesso registrado, o disjuntor fecha sozinho. Mesmo sem sucesso, uma
// tentativa real é liberada a cada RETRY_AFTER_MS (meia-abertura).

export interface HanaProbeRow {
  ok: boolean;
  error_message: string | null;
  created_at: string;
}

export const CIRCUIT_WINDOW_MS = 5 * 60_000;
export const CIRCUIT_MIN_FAILURES = 3;
export const CIRCUIT_RETRY_AFTER_MS = 60_000;

/** Falha de rede (sem resposta do servidor) — não inclui HTTP 4xx/5xx. */
export function isNetworkFailure(row: HanaProbeRow): boolean {
  return !row.ok && /^sem comunica[cç][aã]o:/i.test(row.error_message ?? "");
}

/**
 * Decide se a chamada deve falhar rápido. `rows` = registros mais recentes
 * (ordem decrescente de created_at) da mesma base HANA.
 */
export function shouldShortCircuit(rows: HanaProbeRow[], nowMs: number): boolean {
  const recent = rows.filter((r) => nowMs - Date.parse(r.created_at) <= CIRCUIT_WINDOW_MS);
  if (recent.length < CIRCUIT_MIN_FAILURES) return false;
  // Qualquer sucesso ou resposta HTTP recente fecha o disjuntor.
  if (!recent.slice(0, CIRCUIT_MIN_FAILURES).every(isNetworkFailure)) return false;
  if (recent.some((r) => r.ok)) return false;
  const newest = Date.parse(recent[0].created_at);
  // Meia-abertura: passado o intervalo sem nenhuma tentativa, libera uma real.
  return nowMs - newest < CIRCUIT_RETRY_AFTER_MS;
}

/**
 * Consulta o histórico recente da base. Qualquer erro de leitura mantém o
 * comportamento normal (nunca bloqueia por falha do próprio monitor).
 */
export async function isHanaCircuitOpen(base: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return false;
  try {
    const since = new Date(Date.now() - CIRCUIT_WINDOW_MS).toISOString();
    const variants = [base, `${base}/`].map((v) => `"${v.replace(/"/g, "")}"`).join(",");
    const qs = new URLSearchParams({
      select: "ok,error_message,created_at",
      base_url: `in.(${variants})`,
      created_at: `gte.${since}`,
      order: "created_at.desc",
      limit: "10",
    });
    const r = await fetch(`${url}/rest/v1/hana_health_probes?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) return false;
    const rows = (await r.json()) as HanaProbeRow[];
    return shouldShortCircuit(Array.isArray(rows) ? rows : [], Date.now());
  } catch {
    return false;
  }
}
