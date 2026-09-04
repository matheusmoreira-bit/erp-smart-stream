// CORS por allowlist para funções sensíveis.
//
// Motivação (pentest 2026-07): com `Access-Control-Allow-Origin: *` qualquer
// página maliciosa consegue disparar requisições autenticadas por header
// (cenário de CSRF/replay do relatório). Aqui só devolvemos os cabeçalhos CORS
// quando a Origin pertence à allowlist do produto.

const STATIC_ALLOWED = [
  "https://erp-flow.cactuscorporation.com",
  "https://erp-smart-stream.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:8082",
  "http://localhost:8083",
  "http://127.0.0.1:8082",
  "http://127.0.0.1:8083",
];

const ALLOWED_PATTERNS: RegExp[] = [
  // Previews do Lovable do próprio projeto.
  /^https:\/\/([a-z0-9-]+\.)*lovable\.app$/i,
  /^https:\/\/([a-z0-9-]+\.)*lovableproject\.com$/i,
];

const ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-route, x-sap-user, x-company-db, x-sap-auth-token, x-idempotency-key, x-csrf-token";

function envAllowed(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS") || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  const o = origin.trim().replace(/\/+$/, "");
  if (STATIC_ALLOWED.includes(o)) return true;
  if (envAllowed().includes(o)) return true;
  return ALLOWED_PATTERNS.some((re) => re.test(o));
}

/**
 * Cabeçalhos CORS restritos. Quando a Origin não é permitida devolvemos um
 * objeto sem `Access-Control-Allow-Origin` — o browser bloqueia a leitura da
 * resposta, que é exatamente o efeito desejado contra páginas maliciosas.
 *
 * Chamadas server-to-server (sem Origin) continuam funcionando.
 */
export function corsFor(req: Request, methods = "POST, OPTIONS"): Record<string, string> {
  const origin = req.headers.get("origin");
  const base: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
  };
  if (!origin) return base; // sem Origin => não é um browser cross-site
  if (isOriginAllowed(origin)) {
    return { ...base, "Access-Control-Allow-Origin": origin };
  }
  return base;
}

/**
 * Bloqueio ativo: rejeita requisições cross-site vindas de origens
 * desconhecidas antes mesmo de processar o corpo.
 */
export function rejectForeignOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (isOriginAllowed(origin)) return null;
  return new Response(
    JSON.stringify({ error: "Origem não permitida." }),
    { status: 403, headers: { "Content-Type": "application/json", Vary: "Origin" } },
  );
}
