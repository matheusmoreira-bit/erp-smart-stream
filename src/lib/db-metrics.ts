/**
 * Coleta de métricas de consultas ao banco (client-side).
 *
 * Instrumenta o `fetch` global e mede toda chamada ao Data API (REST/RPC) e às
 * edge functions, associando-a à tela (rota) em que foi disparada. Os eventos
 * são enviados em lote para `public.record_db_query_metrics`, que grava em
 * `public.db_query_metrics` (leitura restrita a administradores).
 *
 * Nunca lança: observabilidade não pode quebrar a aplicação.
 */
import { supabase } from "@/integrations/supabase/client";
import { NAV_MODULES } from "@/lib/nav-map";

export interface DbQueryEvent {
  screen: string;
  source: "rest" | "rpc" | "functions" | "storage";
  target: string;
  operation: string;
  duration_ms: number;
  ok: boolean;
  status_code?: number | null;
  row_count?: number | null;
  company_db?: string | null;
}

const FLUSH_INTERVAL_MS = 15_000;
const MAX_BATCH = 60;
const MAX_QUEUE = 300;

const queue: DbQueryEvent[] = [];
let timer: number | null = null;
let installed = false;

/* ------------------------------------------------------------------ telas */

const EXTRA_SCREEN_LABELS: Record<string, string> = {
  "/": "Painel",
  "/index": "Painel",
  "/backoffice": "Backoffice",
  "/backoffice/infra-health": "Backoffice · Infra",
  "/backoffice/desempenho-banco": "Backoffice · Desempenho do banco",
  "/backoffice/saude-integracoes": "Backoffice · Saúde das integrações",
  "/backoffice/retry-queue": "Backoffice · Fila de retentativas",
  "/backoffice/audit-trail": "Backoffice · Trilha de auditoria",
  "/backoffice/copiloto": "Backoffice · Copiloto",
  "/perfil": "Perfil",
  "/usuarios": "Usuários",
  "/notificacoes": "Notificações",
  "/analytics": "Analytics",
};

let navLabels: Record<string, string> | null = null;

function buildNavLabels(): Record<string, string> {
  if (navLabels) return navLabels;
  const map: Record<string, string> = {};
  for (const mod of NAV_MODULES) {
    for (const item of mod.items) {
      const path = item.path.split("?")[0];
      map[path] = `${mod.label} · ${item.label}`;
    }
  }
  navLabels = map;
  return map;
}

/** Nome amigável da tela atual, sem IDs dinâmicos na rota. */
export function currentScreen(): string {
  if (typeof window === "undefined") return "desconhecida";
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const nav = buildNavLabels();
  if (nav[path]) return nav[path];
  if (EXTRA_SCREEN_LABELS[path]) return EXTRA_SCREEN_LABELS[path];
  // remove segmentos que parecem IDs (uuid / numérico)
  const normalized = path
    .split("/")
    .map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^\d+$/.test(seg) ? ":id" : seg,
    )
    .join("/");
  return nav[normalized] ?? EXTRA_SCREEN_LABELS[normalized] ?? (normalized || "/");
}

/* --------------------------------------------------------------- ingestão */

export function trackDbQuery(event: DbQueryEvent): void {
  try {
    if (queue.length >= MAX_QUEUE) return;
    queue.push(event);
    if (queue.length >= MAX_BATCH) void flushDbMetrics();
    else scheduleFlush();
  } catch {
    /* noop */
  }
}

function scheduleFlush() {
  if (timer != null || typeof window === "undefined") return;
  timer = window.setTimeout(() => {
    timer = null;
    void flushDbMetrics();
  }, FLUSH_INTERVAL_MS);
}

export async function flushDbMetrics(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return; // sem sessão Cloud: não há como gravar
    await supabase.rpc("record_db_query_metrics", {
      _events: batch as unknown as never,
    });
  } catch {
    /* nunca propaga */
  }
}

/* --------------------------------------------------- instrumentação fetch */

function companyDb(): string | null {
  try {
    const raw = sessionStorage.getItem("erp_session_v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { companyDB?: string };
    return parsed?.companyDB ?? null;
  } catch {
    return null;
  }
}

function operationFor(method: string, source: DbQueryEvent["source"]): string {
  if (source === "rpc") return "rpc";
  if (source === "functions") return "invoke";
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
      return "select";
    case "POST":
      return "insert";
    case "PATCH":
    case "PUT":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return method.toLowerCase();
  }
}

/** Extrai origem/alvo a partir da URL do Supabase; null se não for do backend. */
function classify(url: string): { source: DbQueryEvent["source"]; target: string } | null {
  const rest = url.indexOf("/rest/v1/");
  if (rest >= 0) {
    const rem = url.slice(rest + "/rest/v1/".length).split("?")[0];
    if (rem.startsWith("rpc/")) return { source: "rpc", target: rem.slice(4) };
    return { source: "rest", target: rem || "root" };
  }
  const fn = url.indexOf("/functions/v1/");
  if (fn >= 0) {
    return { source: "functions", target: url.slice(fn + "/functions/v1/".length).split("?")[0] };
  }
  const st = url.indexOf("/storage/v1/");
  if (st >= 0) {
    return { source: "storage", target: url.slice(st + "/storage/v1/".length).split("?")[0].slice(0, 80) };
  }
  return null;
}

function rowCountFrom(res: Response): number | null {
  const range = res.headers.get("content-range");
  if (!range) return null;
  const m = /^(\d+)-(\d+)\//.exec(range);
  if (!m) return null;
  return Number(m[2]) - Number(m[1]) + 1;
}

/** Ativa a instrumentação global (idempotente). */
export function installDbMetrics(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = "";
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    } catch {
      /* noop */
    }

    const isBackend = !!url && (!supabaseUrl || url.startsWith(supabaseUrl));
    const info = isBackend ? classify(url) : null;
    // não instrumenta a própria ingestão (evita laço)
    if (!info || info.target === "record_db_query_metrics") {
      return originalFetch(input as RequestInfo, init);
    }

    const method = init?.method ?? (typeof input !== "string" && "method" in (input as Request) ? (input as Request).method : "GET");
    const screen = currentScreen();
    const started = performance.now();
    try {
      const res = await originalFetch(input as RequestInfo, init);
      trackDbQuery({
        screen,
        source: info.source,
        target: info.target,
        operation: operationFor(method, info.source),
        duration_ms: Math.round(performance.now() - started),
        ok: res.ok,
        status_code: res.status,
        row_count: rowCountFrom(res),
        company_db: companyDb(),
      });
      return res;
    } catch (e) {
      trackDbQuery({
        screen,
        source: info.source,
        target: info.target,
        operation: operationFor(method, info.source),
        duration_ms: Math.round(performance.now() - started),
        ok: false,
        status_code: 0,
        row_count: null,
        company_db: companyDb(),
      });
      throw e;
    }
  };

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushDbMetrics();
  });
  window.addEventListener("pagehide", () => void flushDbMetrics());
}
