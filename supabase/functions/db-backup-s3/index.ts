// Backup lógico do schema public + contas de login para S3 (F07).
// - Acesso: somente agendador (segredo), service role ou administrador.
// - Cada tabela vira partes JSONL gzip cifradas (AES-256-GCM, BACKUP_ENC_KEY).
// - Inclui audit_trail/audit_trail_archive e auth.users (sem hashes de senha — não expostos pela API).
// - Grava com criptografia no S3 (SSE) e Object Lock quando BACKUP_OBJECT_LOCK_DAYS estiver definido.
// Body opcional: { manual?: boolean, tables?: string[] } (tables permite rodar só algumas tabelas).
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { S3Client, PutObjectCommand, type PutObjectCommandInput } from "npm:@aws-sdk/client-s3@3.658.0";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { encryptBackup } from "../_shared/backup-crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWS_REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const BUCKET = Deno.env.get("AWS_S3_BACKUP_BUCKET");
const LOCK_DAYS = Number(Deno.env.get("BACKUP_OBJECT_LOCK_DAYS") || "0");
const CHUNK = 5000;
const ROWS_PER_PART = 50000;

// Apenas caches reconstruíveis a partir do SAP ficam de fora.
const SKIP_TABLES = new Set<string>(["sap_cache"]);
const TABLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;

type Sb = ReturnType<typeof createClient>;
type ManifestEntry = { table: string; count: number; parts: { key: string; rows: number; bytes: number; sha256: string }[] };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function listPublicTables(sb: Sb): Promise<string[]> {
  const { data, error } = await sb.rpc("copilot_read_query", {
    p_sql: `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
  });
  if (error) throw new Error(`list tables: ${error.message}`);
  const d = data as { rows?: { table_name: string }[] } | { table_name: string }[] | null;
  const rows = Array.isArray(d) ? d : d?.rows ?? [];
  return rows.map((r) => r.table_name);
}

function putParams(key: string, body: Uint8Array, sha256: string): PutObjectCommandInput {
  const p: PutObjectCommandInput = {
    Bucket: BUCKET!, Key: key, Body: body,
    ContentType: "application/octet-stream",
    ServerSideEncryption: "AES256",
    Metadata: { sha256, format: "erpbk1-gzip-jsonl" },
  };
  if (LOCK_DAYS > 0) {
    p.ObjectLockMode = "COMPLIANCE";
    p.ObjectLockRetainUntilDate = new Date(Date.now() + LOCK_DAYS * 86400_000);
  }
  return p;
}

async function uploadPart(s3: S3Client, key: string, jsonl: string) {
  const gz = gzipSync(new TextEncoder().encode(jsonl));
  const enc = await encryptBackup(new Uint8Array(gz));
  const sha = createHash("sha256").update(enc).digest("hex");
  await s3.send(new PutObjectCommand(putParams(key, enc, sha)));
  return { bytes: enc.length, sha256: sha };
}

async function dumpTable(sb: Sb, s3: S3Client, prefix: string, table: string): Promise<ManifestEntry> {
  const entry: ManifestEntry = { table, count: 0, parts: [] };
  let from = 0;
  let buf = "";
  let bufRows = 0;
  const flush = async () => {
    if (bufRows === 0) return;
    const key = `${prefix}/${table}.part${String(entry.parts.length).padStart(4, "0")}.jsonl.gz.enc`;
    const r = await uploadPart(s3, key, buf);
    entry.parts.push({ key, rows: bufRows, ...r });
    buf = ""; bufRows = 0;
  };
  while (true) {
    const { data, error } = await sb.from(table).select("*").range(from, from + CHUNK - 1);
    if (error) throw new Error(`dump ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) buf += JSON.stringify(row) + "\n";
    bufRows += data.length;
    entry.count += data.length;
    if (bufRows >= ROWS_PER_PART) await flush();
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  await flush();
  return entry;
}

async function dumpAuthUsers(sb: Sb, s3: S3Client, prefix: string): Promise<ManifestEntry> {
  const entry: ManifestEntry = { table: "auth.users", count: 0, parts: [] };
  let page = 1;
  let buf = "";
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth.users: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) buf += JSON.stringify(u) + "\n";
    entry.count += users.length;
    if (users.length < 1000) break;
    page++;
  }
  if (entry.count > 0) {
    const key = `${prefix}/auth.users.part0000.jsonl.gz.enc`;
    const r = await uploadPart(s3, key, buf);
    entry.parts.push({ key, rows: entry.count, ...r });
  }
  return entry;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const started = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let logId: string | null = null;

  try {
    if (!AWS_KEY || !AWS_SECRET || !BUCKET) {
      return json(400, { error: "Backup S3 não configurado (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_S3_BACKUP_BUCKET)" });
    }
    if (!Deno.env.get("BACKUP_ENC_KEY")) return json(400, { error: "BACKUP_ENC_KEY ausente" });

    const body = (await req.json().catch(() => ({}))) as { manual?: unknown; tables?: unknown };
    const manual = body.manual === true;
    const only = Array.isArray(body.tables)
      ? body.tables.filter((t): t is string => typeof t === "string" && TABLE_RE.test(t)).slice(0, 50)
      : null;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const prefix = `daily/${stamp.slice(0, 10)}/${stamp}`;

    const { data: logRow } = await sb.from("infra_backup_log").insert({
      kind: "db", status: "running", trigger: manual ? "manual" : auth.source,
      bucket: BUCKET, s3_prefix: prefix,
    }).select("id").single();
    logId = (logRow as { id?: string } | null)?.id ?? null;

    const s3 = new S3Client({ region: AWS_REGION, credentials: { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET } });
    const all = await listPublicTables(sb);
    const tables = only ? all.filter((t) => only.includes(t)) : all;
    const manifest: ManifestEntry[] = [];
    const errors: string[] = [];
    let totalBytes = 0;

    for (const t of tables) {
      if (SKIP_TABLES.has(t)) continue;
      try {
        const e = await dumpTable(sb, s3, prefix, t);
        manifest.push(e);
        totalBytes += e.parts.reduce((s, p) => s + p.bytes, 0);
      } catch (e) {
        errors.push(`${t}: ${(e as Error).message}`);
      }
    }
    if (!only) {
      try {
        const e = await dumpAuthUsers(sb, s3, prefix);
        manifest.push(e);
        totalBytes += e.parts.reduce((s, p) => s + p.bytes, 0);
      } catch (e) {
        errors.push(`auth.users: ${(e as Error).message}`);
      }
    }

    const manifestJson = JSON.stringify({
      format: "erpbk1", generated_at: new Date().toISOString(), partial_selection: Boolean(only),
      object_lock_days: LOCK_DAYS, tables: manifest, errors,
    }, null, 2);
    const mBody = new TextEncoder().encode(manifestJson);
    const mSha = createHash("sha256").update(mBody).digest("hex");
    await s3.send(new PutObjectCommand({ ...putParams(`${prefix}/manifest.json`, mBody, mSha), ContentType: "application/json" }));

    const status = errors.length === 0 ? "ok" : "partial";
    if (logId) await sb.from("infra_backup_log").update({
      status, finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
      tables_count: manifest.length, total_bytes: totalBytes,
      manifest: { tables: manifest.length, errors: errors.length, manifest_sha256: mSha },
      error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
    }).eq("id", logId);

    await sb.rpc("insert_audit_log", {
      p_action: "db_backup_s3", p_entity_type: "backup", p_entity_id: prefix,
      p_details: { status, tables: manifest.length, total_bytes: totalBytes, source: auth.source },
    }).then(() => undefined, () => undefined);

    return json(200, { ok: true, status, prefix, tables: manifest.length, total_bytes: totalBytes, errors });
  } catch (e) {
    const msg = (e as Error).message;
    if (logId) await sb.from("infra_backup_log").update({
      status: "error", finished_at: new Date().toISOString(), duration_ms: Date.now() - started, error_message: msg,
    }).eq("id", logId);
    return json(500, { error: msg });
  }
});
