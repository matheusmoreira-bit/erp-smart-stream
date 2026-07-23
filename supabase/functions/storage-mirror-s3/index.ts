// Mirror de anexos (Supabase Storage) para S3.
// Executa por bucket, listando objetos e enviando os novos/alterados (compara etag).
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "npm:@aws-sdk/client-s3@3.658.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWS_REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const BUCKET = Deno.env.get("AWS_S3_BACKUP_BUCKET");

const BUCKETS_TO_MIRROR = ["expense-attachments", "receipts"]; // ajustar conforme buckets reais
const MAX_OBJECTS_PER_RUN = 2000;

async function listAll(sb: ReturnType<typeof createClient>, bucket: string, prefix = ""): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  while (out.length < MAX_OBJECTS_PER_RUN) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const item of data) {
      if (item.id) out.push({ ...item, _path: prefix ? `${prefix}/${item.name}` : item.name });
      else {
        const sub = await listAll(sb, bucket, prefix ? `${prefix}/${item.name}` : item.name);
        out.push(...sub);
      }
      if (out.length >= MAX_OBJECTS_PER_RUN) break;
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let logId: string | null = null;

  try {
    if (!AWS_KEY || !AWS_SECRET || !BUCKET) {
      return new Response(JSON.stringify({ error: "AWS secrets missing" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const manual = Boolean(body.manual);
    const prefix = `storage/${new Date().toISOString().slice(0, 10)}`;

    const { data: logRow } = await sb.from("infra_backup_log").insert({
      kind: "storage", status: "running", trigger: manual ? "manual" : "cron",
      bucket: BUCKET, s3_prefix: prefix,
    }).select("id").single();
    logId = (logRow as any)?.id ?? null;

    const s3 = new S3Client({ region: AWS_REGION, credentials: { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET } });
    let objectsCount = 0, totalBytes = 0;
    const errors: string[] = [];

    for (const srcBucket of BUCKETS_TO_MIRROR) {
      try {
        const items = await listAll(sb, srcBucket);
        for (const it of items) {
          const s3Key = `${srcBucket}/${it._path}`;
          try {
            // Skip if exists and same size
            const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key })).catch(() => null);
            if (head && head.ContentLength === it.metadata?.size) continue;
            const { data: blob, error: dlErr } = await sb.storage.from(srcBucket).download(it._path);
            if (dlErr || !blob) { errors.push(`${srcBucket}/${it._path}: ${dlErr?.message}`); continue; }
            const buf = new Uint8Array(await blob.arrayBuffer());
            await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: s3Key, Body: buf, ContentType: it.metadata?.mimetype || "application/octet-stream" }));
            objectsCount++; totalBytes += buf.length;
          } catch (e) {
            errors.push(`${srcBucket}/${it._path}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        errors.push(`bucket ${srcBucket}: ${(e as Error).message}`);
      }
    }

    const status = errors.length === 0 ? "ok" : "partial";
    if (logId) await sb.from("infra_backup_log").update({
      status, finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
      objects_count: objectsCount, total_bytes: totalBytes,
      error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
    }).eq("id", logId);

    return new Response(JSON.stringify({ ok: true, status, objects: objectsCount, total_bytes: totalBytes, errors: errors.length }), {
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
