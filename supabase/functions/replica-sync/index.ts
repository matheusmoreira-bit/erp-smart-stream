// Carga incremental diária para a réplica (F07). Backup oficial = réplica.
// - Acesso: agendador (segredo), service role ou administrador.
// - Origem: SUPABASE_DB_URL. Destino: REPLICA_DB_URL (segredo).
// - Tabelas append-only com cursor por id (bigint): lê id > max(id) da réplica.
// - Roda em lotes até ~110s; se sobrar, reencadeia a si mesma (máx. MAX_HOPS).
import postgres from "npm:postgres@3.4.4";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-secret",
};

// Ordem de carga. Começa pela trilha de auditoria.
const ID_CURSOR_TABLES = ["audit_trail", "audit_trail_archive"] as const;
type SyncTable = typeof ID_CURSOR_TABLES[number];

const BATCH = 1500;
const TIME_BUDGET_MS = 25_000; // curto: limite de CPU por execução
const MAX_HOPS = 300;


function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function syncTable(src: postgres.Sql, dst: postgres.Sql, table: SyncTable, deadline: number) {
  const [{ max }] = await dst`select coalesce(max(id), 0)::bigint as max from ${dst("public." + table)}`;
  let cursor = BigInt(max as string | number);
  let copied = 0;
  let done = false;
  while (Date.now() < deadline) {
    if (Date.now() >= deadline) break;
    // Lote vem pronto como texto JSON do banco — sem parse em JS (limite de CPU da função).
    const [b] = await src`
      select count(*)::int as n, max(id)::text as last, coalesce(json_agg(t order by id), '[]')::text as payload
      from (select * from ${src("public." + table)} where id > ${cursor.toString()} order by id limit ${BATCH}) t`;
    const n = b.n as number;
    if (n === 0) { done = true; break; }
    await dst`
      insert into ${dst("public." + table)}
      select * from json_populate_recordset(null::${dst("public." + table)}, (${b.payload as string}::text)::json)
      on conflict (id) do nothing`;
    copied += n;
    cursor = BigInt(b.last as string);
    if (n < BATCH) { done = true; break; }
  }
  // max(id) usa o índice da chave primária — barato mesmo em tabelas grandes.
  const [{ m: srcMax }] = await src`select coalesce(max(id), 0)::bigint as m from ${src("public." + table)}`;
  return { table, copied, cursor: cursor.toString(), done, source_max_id: String(srcMax), lag_ids: String(BigInt(srcMax as string | number) - cursor) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const srcUrl = Deno.env.get("SUPABASE_DB_URL");
  const dstUrl = Deno.env.get("REPLICA_DB_URL");
  if (!srcUrl || !dstUrl) return json(400, { error: "Conexões da origem/réplica não configuradas" });

  const body = (await req.json().catch(() => ({}))) as { hop?: unknown };
  const hop = typeof body.hop === "number" && body.hop >= 0 && body.hop <= MAX_HOPS ? Math.floor(body.hop) : 0;

  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const src = postgres(srcUrl, { max: 1, prepare: false, idle_timeout: 5 });
  const dst = postgres(dstUrl, { max: 1, prepare: false, idle_timeout: 5, ssl: "require" });
  const results: Awaited<ReturnType<typeof syncTable>>[] = [];
  const errors: string[] = [];

  try {
    const [{ locked }] = await dst`select pg_try_advisory_lock(707007) as locked`;
    if (!locked) {
      await src.end({ timeout: 5 }).catch(() => undefined);
      await dst.end({ timeout: 5 }).catch(() => undefined);
      return json(200, { ok: true, skipped: "outra rodada em andamento" });
    }
    await dst`set session_replication_role = replica`;
    for (const t of ID_CURSOR_TABLES) {
      if (Date.now() >= deadline) break;
      try { results.push(await syncTable(src, dst, t, deadline)); }
      catch (e) { errors.push(`${t}: ${(e as Error).message}`); }
    }
  } catch (e) {
    errors.push((e as Error).message);
  } finally {
    await src.end({ timeout: 5 }).catch(() => undefined);
    await dst.end({ timeout: 5 }).catch(() => undefined);
  }

  const allDone = results.length === ID_CURSOR_TABLES.length && results.every((r) => r.done);
  const copied = results.reduce((s, r) => s + r.copied, 0);
  await sb.from("infra_backup_log").insert({
    kind: "replica", status: errors.length ? "partial" : allDone ? "ok" : "running",
    trigger: hop > 0 ? "chain" : auth.source, bucket: "replica", s3_prefix: `hop-${hop}`,
    finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
    tables_count: results.length, manifest: { results, copied },
    error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
  }).then(() => undefined, () => undefined);

  // Reencadeia enquanto houver atraso, sem erros.
  if (!allDone && errors.length === 0 && hop < MAX_HOPS && copied > 0) {
    // Dispara a próxima rodada e só espera o aceite (a rodada segue após o corte).
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/replica-sync`, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          "Content-Type": "application/json",
          "x-scheduler-secret": Deno.env.get("SCHEDULER_SECRET") || "",
        },
        body: JSON.stringify({ hop: hop + 1 }),
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.error("chain failed", (e as Error).message);
    } finally { clearTimeout(timer); }
  }

  return json(errors.length ? 207 : 200, { ok: errors.length === 0, hop, all_done: allDone, copied, results, errors });
});
