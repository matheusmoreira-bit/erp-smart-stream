// Agendador mensal da auditoria do fluxo de compras.
// Executa no dia 10 de cada mês (cron) e dispara uma auditoria por empresa
// ativa, sempre olhando para o mês fechado anterior (ex.: 10/09 → 01/08 a 31/08).
//
// Autenticação: header `x-cron-secret` igual ao segredo CRON_SECRET.
// Não é chamável publicamente sem esse segredo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SERVICE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const TZ = "America/Sao_Paulo";

/** Data "hoje" no fuso de São Paulo (YYYY-MM-DD). */
function todaySaoPaulo(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = parts.split("-").map((n) => Number(n));
  return { y, m, d };
}

/** Primeiro e último dia do mês anterior à referência. */
export function previousMonthRange(y: number, m: number): { from: string; to: string } {
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { from: `${py}-${p(pm)}-01`, to: `${py}-${p(pm)}-${p(lastDay)}` };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || !timingSafeEqual(provided, CRON_SECRET)) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  let body: { dateFrom?: string; dateTo?: string; companies?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { y, m } = todaySaoPaulo();
  const range = previousMonthRange(y, m);
  const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom : range.from;
  const dateTo = typeof body.dateTo === "string" ? body.dateTo : range.to;

  const sb = createClient(SERVICE_URL, SERVICE_KEY);
  let query = sb
    .from("companies")
    .select("company_db, display_name, erp_type")
    .eq("is_active", true)
    .eq("is_test", false);
  if (Array.isArray(body.companies) && body.companies.length > 0) {
    query = query.in("company_db", body.companies.filter((c) => typeof c === "string").slice(0, 50));
  }
  const { data: companies, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const targets = (companies ?? []).filter((c) => (c.erp_type ?? "sap") === "sap");
  const results: Array<{ company_db: string; status: string; runId?: string; error?: string }> = [];

  for (const c of targets) {
    try {
      const resp = await fetch(`${SERVICE_URL}/functions/v1/audit-console-run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ companyDB: c.company_db, scope: "compras", dateFrom, dateTo }),
      });
      const payload = await resp.json().catch(() => ({}));
      results.push({
        company_db: c.company_db,
        status: resp.ok ? "started" : `error_${resp.status}`,
        runId: payload?.runId,
        error: resp.ok ? undefined : String(payload?.error ?? "").slice(0, 300),
      });
    } catch (e) {
      results.push({ company_db: c.company_db, status: "error", error: (e as Error).message });
    }
  }

  console.log("[audit-console-monthly]", JSON.stringify({ dateFrom, dateTo, results }));
  return json({ dateFrom, dateTo, companies: targets.length, results });
});
