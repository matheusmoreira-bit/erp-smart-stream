// Modo standalone (temporário) por empresa.
//
// Quando o ERP (SAP/HANA) de uma empresa está fora do ar por um período
// planejado, o Flow continua operando com os cadastros já copiados para o
// banco (`sap_cache`) e TODA integração com o ERP daquela empresa fica pausada.
// Documentos aprovados permanecem na fila e são enviados ao ERP assim que o
// modo é desligado (o worker `expense-integration-retry` reprocessa sozinho).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let _client: ReturnType<typeof createClient> | null = null;
function admin() {
  if (!_client) _client = createClient(SUPABASE_URL, SERVICE_KEY);
  return _client;
}

export interface StandaloneInfo {
  company_db: string;
  reason: string | null;
  ends_at: string | null;
}

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: StandaloneInfo | null }>();

/** Empresa em modo standalone? Retorna os dados do modo ou null. */
export async function getStandaloneMode(
  companyDb: string | null | undefined,
): Promise<StandaloneInfo | null> {
  if (!companyDb) return null;
  const hit = cache.get(companyDb);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  let value: StandaloneInfo | null = null;
  try {
    const { data } = await admin()
      .from("standalone_mode")
      .select("company_db, enabled, reason, ends_at")
      .eq("company_db", companyDb)
      .maybeSingle();
    if (data?.enabled) {
      const ends = data.ends_at ? new Date(data.ends_at as string).getTime() : null;
      if (ends === null || !isFinite(ends) || ends > Date.now()) {
        value = {
          company_db: companyDb,
          reason: (data.reason as string) ?? null,
          ends_at: (data.ends_at as string) ?? null,
        };
      }
    }
  } catch {
    value = null;
  }
  cache.set(companyDb, { at: Date.now(), value });
  return value;
}

/** Lista das empresas atualmente em modo standalone (para os workers). */
export async function listStandaloneCompanies(): Promise<string[]> {
  try {
    const { data } = await admin()
      .from("standalone_mode")
      .select("company_db, enabled, ends_at")
      .eq("enabled", true);
    const now = Date.now();
    return (data || [])
      .filter((r: any) => !r.ends_at || new Date(r.ends_at).getTime() > now)
      .map((r: any) => String(r.company_db));
  } catch {
    return [];
  }
}

export function standaloneResponse(
  info: StandaloneInfo,
  corsHeaders: Record<string, string>,
) {
  const until = info.ends_at
    ? ` até ${new Date(info.ends_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
    : "";
  return new Response(
    JSON.stringify({
      success: false,
      standalone: true,
      company_db: info.company_db,
      ends_at: info.ends_at,
      reason: info.reason,
      error:
        `Empresa em modo standalone${until}: a integração com o ERP está pausada. ` +
        `O documento fica registrado no Flow e será enviado automaticamente quando o modo for desligado.`,
    }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

/** Bypass interno (snapshot de cadastros) autenticado pela service role key. */
export function isStandaloneBypass(req: Request): boolean {
  const header = req.headers.get("x-standalone-bypass") || "";
  return !!header && header === SERVICE_KEY;
}
