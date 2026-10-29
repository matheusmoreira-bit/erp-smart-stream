// Mirror de anexos (Supabase Storage) para S3.
// Executa por bucket, listando objetos e enviando os novos/alterados (compara etag).
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-secret" };
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { s3Client, s3Put, s3ListSizes, s3Get } from "../_shared/s3-put.ts";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWS_REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const BUCKET = Deno.env.get("AWS_S3_BACKUP_BUCKET");

const BUCKETS_TO_MIRROR = ["expense-attachments", "receipts", "sap-archive"];
// Limites por execução: o restante segue na próxima rodada (incremental).
const MAX_LIST_PER_BUCKET = 200_000;
const MAX_UPLOADS_PER_RUN = 1500;
const TIME_BUDGET_MS = 110_000;
const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function listAll(sb: ReturnType<typeof createClient>, bucket: string, prefix = ""): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  while (out.length < MAX_LIST_PER_BUCKET) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const item of data) {
      if (item.id) out.push({ ...item, _path: prefix ? `${prefix}/${item.name}` : item.name });
      else {
        const sub = await listAll(sb, bucket, prefix ? `${prefix}/${item.name}` : item.name);
        out.push(...sub);
      }
      if (out.length >= MAX_LIST_PER_BUCKET) break;
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireSchedulerOrAdmin(req, corsHeaders);
  if (!auth.ok) return auth.response;
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

    const s3 = s3Client(AWS_REGION, AWS_KEY, AWS_SECRET);
    let objectsCount = 0, totalBytes = 0, uploads = 0, budgetHit = false;
    const errors: string[] = [];
    const perBucket: Record<string, { listed: number; already: number; sent: number; bytes: number; pending: number }> = {};
    const only: string[] | null = Array.isArray(body.buckets) ? body.buckets.filter((b: unknown) => BUCKETS_TO_MIRROR.includes(String(b))) : null;
    let sample: { key: string; srcBucket: string; path: string } | null = null;

    for (const srcBucket of only ?? BUCKETS_TO_MIRROR) {
      const st = perBucket[srcBucket] = { listed: 0, already: 0, sent: 0, bytes: 0, pending: 0 };
      try {
        const items = await listAll(sb, srcBucket);
        st.listed = items.length;
        // Incremental: compara nome + tamanho com o que já existe no S3 (sha256 gravado em metadado).
        const existing = await s3ListSizes(s3, AWS_REGION, BUCKET, `${srcBucket}/`);
        for (const it of items) {
          const s3Key = `${srcBucket}/${it._path}`;
          const size = Number(it.metadata?.size ?? -1);
          if (existing.has(s3Key) && (size < 0 || existing.get(s3Key) === size)) {
            st.already++;
            if (!sample && srcBucket === "sap-archive") sample = { key: s3Key, srcBucket, path: it._path };
            continue;
          }
          if (uploads >= MAX_UPLOADS_PER_RUN || Date.now() - started > TIME_BUDGET_MS) { st.pending++; budgetHit = true; continue; }
          try {
            const { data: blob, error: dlErr } = await sb.storage.from(srcBucket).download(it._path);
            if (dlErr || !blob) { errors.push(`${srcBucket}/${it._path}: ${dlErr?.message}`); continue; }
            const buf = new Uint8Array(await blob.arrayBuffer());
            await s3Put(s3, AWS_REGION, BUCKET, s3Key, buf, { contentType: it.metadata?.mimetype || "application/octet-stream", sha256: sha256Hex(buf), lockDays: Number(Deno.env.get("BACKUP_OBJECT_LOCK_DAYS") || "0") });
            uploads++; objectsCount++; totalBytes += buf.length; st.sent++; st.bytes += buf.length;
            if (srcBucket === "sap-archive") sample = { key: s3Key, srcBucket, path: it._path };
          } catch (e) {
            errors.push(`${srcBucket}/${it._path}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        errors.push(`bucket ${srcBucket}: ${(e as Error).message}`);
      }
    }

    // Leitura de volta de 1 objeto do sap-archive: tamanho e sha256 devem bater com a origem.
    let verify: Record<string, unknown> | null = null;
    if (sample) {
      try {
        const remote = await s3Get(s3, AWS_REGION, BUCKET, sample.key);
        const { data: blob } = await sb.storage.from(sample.srcBucket).download(sample.path);
        const local = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
        const rs = sha256Hex(remote.body), ls = sha256Hex(local);
        verify = { key: sample.key, s3_bytes: remote.body.length, src_bytes: local.length, sha_match: rs === ls, meta_sha_match: remote.sha256Meta ? remote.sha256Meta === ls : null };
      } catch (e) { verify = { key: sample.key, error: (e as Error).message }; }
    }

    const status = errors.length === 0 && !budgetHit ? "ok" : "partial";
    if (logId) await sb.from("infra_backup_log").update({
      status, finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
      objects_count: objectsCount, total_bytes: totalBytes,
      manifest: { per_bucket: perBucket, verify, budget_hit: budgetHit },
      error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
    }).eq("id", logId);

    return new Response(JSON.stringify({ ok: true, status, objects: objectsCount, total_bytes: totalBytes, per_bucket: perBucket, verify, errors: errors.length, log_id: logId }), {
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
