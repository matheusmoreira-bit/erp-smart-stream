// Backup lógico do schema public para S3 (JSONL gzip por tabela + manifest.json)
// Agendado diariamente via pg_cron; também aceita execução manual (POST { manual: true }).
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3.658.0";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWS_REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const BUCKET = Deno.env.get("AWS_S3_BACKUP_BUCKET");
const CHUNK = 5000;

// Tabelas grandes / com PII sensível — não incluir integralmente ou fazer sample:
const SKIP_TABLES = new Set<string>([
  "audit_trail", // muito grande, tem tabela archive separada
  "audit_trail_archive",
  "permission_shadow_log",
  "integration_log",
  "sap_cache",
]);

async function listPublicTables(sb: ReturnType<typeof createClient>): Promise<string[]> {
  const { data, error } = await sb.rpc("copilot_read_query", {
    p_sql: `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
  });
  if (error) throw new Error(`list tables: ${error.message}`);
  const rows = (data as any)?.rows ?? (Array.isArray(data) ? data : []);
  return rows.map((r: any) => r.table_name);
}

async function dumpTable(sb: ReturnType<typeof createClient>, table: string): Promise<{ jsonl: string; count: number }> {
  let from = 0;
  let out = "";
  let total = 0;
  while (true) {
    const { data, error } = await sb.from(table).select("*").range(from, from + CHUNK - 1);
    if (error) throw new Error(`dump ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) out += JSON.stringify(row) + "\n";
    total += data.length;
    if (data.length < CHUNK) break;
    from += CHUNK;
    if (total > 500000) break; // safety cap
  }
  return { jsonl: out, count: total };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let logId: string | null = null;

  try {
    if (!AWS_KEY || !AWS_SECRET || !BUCKET) {
      return new Response(JSON.stringify({ error: "AWS S3 secrets missing (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_S3_BACKUP_BUCKET)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const manual = Boolean(body.manual);
    const dateStr = new Date().toISOString().slice(0, 10);
    const prefix = `daily/${dateStr}`;

    const { data: logRow } = await sb.from("infra_backup_log").insert({
      kind: "db", status: "running", trigger: manual ? "manual" : "cron",
      bucket: BUCKET, s3_prefix: prefix,
    }).select("id").single();
    logId = (logRow as any)?.id ?? null;

    const s3 = new S3Client({ region: AWS_REGION, credentials: { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET } });
    const tables = await listPublicTables(sb);
    const manifest: any[] = [];
    let totalBytes = 0;
    let okCount = 0;
    const errors: string[] = [];

    for (const t of tables) {
      if (SKIP_TABLES.has(t)) continue;
      try {
        const { jsonl, count } = await dumpTable(sb, t);
        if (count === 0) { manifest.push({ table: t, count: 0, skipped: true }); continue; }
        const gz = gzipSync(new TextEncoder().encode(jsonl));
        const sha = createHash("sha256").update(gz).digest("hex");
        const key = `${prefix}/${t}.jsonl.gz`;
        await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: gz, ContentType: "application/gzip", ContentEncoding: "gzip" }));
        manifest.push({ table: t, count, bytes: gz.length, sha256: sha, key });
        totalBytes += gz.length;
        okCount++;
      } catch (e) {
        errors.push(`${t}: ${(e as Error).message}`);
      }
    }

    const manifestBody = new TextEncoder().encode(JSON.stringify({
      generated_at: new Date().toISOString(), tables: manifest, errors,
    }, null, 2));
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${prefix}/manifest.json`, Body: manifestBody, ContentType: "application/json" }));

    const status = errors.length === 0 ? "ok" : "partial";
    if (logId) await sb.from("infra_backup_log").update({
      status, finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
      tables_count: okCount, total_bytes: totalBytes,
      manifest: { tables: manifest.length, errors: errors.length },
      error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
    }).eq("id", logId);

    return new Response(JSON.stringify({ ok: true, status, tables: okCount, total_bytes: totalBytes, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (logId) await sb.from("infra_backup_log").update({
      status: "error", finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started, error_message: msg,
    }).eq("id", logId);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
