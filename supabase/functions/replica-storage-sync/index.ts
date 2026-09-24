// Cópia incremental dos arquivos do armazenamento para a réplica (F07).
// Os arquivos ficam no banco da réplica (schema backup_files, sem acesso público).
// - Acesso: agendador (segredo), service role ou administrador.
// - Cursor por (updated_at, id) de storage.objects; arquivos apagados na origem são mantidos na réplica.
// - Rodadas curtas; reencadeia enquanto houver arquivos.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-secret",
};

const BATCH = 20;
const TIME_BUDGET_MS = 25_000;
const MAX_HOPS = 500;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sha256Hex(buf: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Obj = { id: string; bucket_id: string; name: string; updated_at: string; mimetype: string | null; size: string | null };

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
  let copied = 0, bytes = 0, skipped = 0, done = false, remaining = -1;
  const errors: string[] = [];

  try {
    const [{ locked }] = await dst`select pg_try_advisory_lock(707008) as locked`;
    if (!locked) {
      await src.end({ timeout: 5 }).catch(() => undefined);
      await dst.end({ timeout: 5 }).catch(() => undefined);
      return json(200, { ok: true, skipped: "outra rodada em andamento" });
    }
    const cur = await dst`select ts, src_id from backup_files.cursor where id = 1`;
    let ts: string = cur[0]?.ts ? new Date(cur[0].ts).toISOString() : "1970-01-01T00:00:00Z";
    let sid: string = cur[0]?.src_id ?? "00000000-0000-0000-0000-000000000000";

    outer: while (Date.now() < deadline) {
      const rows = await src<Obj[]>`
        select id::text, bucket_id, name, updated_at, metadata->>'mimetype' as mimetype, metadata->>'size' as size
        from storage.objects
        where (coalesce(updated_at, created_at), id) > (${ts}::timestamptz, ${sid}::uuid)
          and name not like '%.emptyFolderPlaceholder'
        order by coalesce(updated_at, created_at), id limit ${BATCH}`;
      if (rows.length === 0) { done = true; break; }
      for (const o of rows) {
        if (Date.now() >= deadline) break outer;
        const size = Number(o.size ?? 0);
        if (size > MAX_FILE_BYTES) { skipped++; errors.push(`grande demais: ${o.bucket_id}/${o.name}`); }
        else {
          const { data, error } = await sb.storage.from(o.bucket_id).download(o.name);
          if (error || !data) { errors.push(`${o.bucket_id}/${o.name}: ${error?.message ?? "sem conteúdo"}`); break outer; }
          const buf = new Uint8Array(await data.arrayBuffer());
          const hash = await sha256Hex(buf);
          await dst`
            insert into backup_files.objects (bucket_id, name, src_id, mimetype, size, sha256, content, src_updated_at)
            values (${o.bucket_id}, ${o.name}, ${o.id}::uuid, ${o.mimetype}, ${buf.byteLength}, ${hash}, ${buf}, ${o.updated_at})
            on conflict (bucket_id, name) do update set src_id = excluded.src_id, mimetype = excluded.mimetype,
              size = excluded.size, sha256 = excluded.sha256, content = excluded.content,
              src_updated_at = excluded.src_updated_at, copied_at = now()
              where backup_files.objects.sha256 <> excluded.sha256`;
          copied++; bytes += buf.byteLength;
        }
        ts = new Date(o.updated_at).toISOString(); sid = o.id;
        await dst`insert into backup_files.cursor (id, ts, src_id) values (1, ${ts}, ${sid}::uuid)
          on conflict (id) do update set ts = excluded.ts, src_id = excluded.src_id`;
      }
      if (rows.length < BATCH) { done = true; break; }
    }
    const [{ n }] = await src`select count(*)::int as n from storage.objects
      where (coalesce(updated_at, created_at), id) > (${ts}::timestamptz, ${sid}::uuid)`;
    remaining = n as number;
    if (remaining === 0) done = true;
  } catch (e) {
    errors.push((e as Error).message);
  } finally {
    await src.end({ timeout: 5 }).catch(() => undefined);
    await dst.end({ timeout: 5 }).catch(() => undefined);
  }

  const fatal = errors.filter((e) => !e.startsWith("grande demais"));
  await sb.from("infra_backup_log").insert({
    kind: "replica", status: fatal.length ? "partial" : done ? "ok" : "running",
    trigger: hop > 0 ? "chain" : auth.source, bucket: "replica-storage", s3_prefix: `files-hop-${hop}`,
    finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
    tables_count: 0, manifest: { copied, bytes, skipped, remaining },
    error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
  }).then(() => undefined, () => undefined);

  if (!done && fatal.length === 0 && hop < MAX_HOPS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/replica-storage-sync`, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-scheduler-secret": Deno.env.get("SCHEDULER_SECRET") || "" },
        body: JSON.stringify({ hop: hop + 1 }),
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.error("chain failed", (e as Error).message);
    } finally { clearTimeout(timer); }
  }

  return json(fatal.length ? 207 : 200, { ok: fatal.length === 0, hop, done, copied, bytes, skipped, remaining, errors });
});
