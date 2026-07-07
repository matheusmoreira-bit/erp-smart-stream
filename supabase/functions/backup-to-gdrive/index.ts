// Backup automático de aprovações, pedidos de compra e anexos para o Google Drive.
// Executa a cada 6h via cron. Retenção de 90 dias para os snapshots de dados.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GD_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY")!;

const ROOT_FOLDER_NAME = "ErpFlow Backups";
const DATA_FOLDER_NAME = "data";
const ATTACH_FOLDER_NAME = "attachments-expenses";
const NF_FOLDER_NAME = "attachments-nf-entrada";
const RETENTION_DAYS = 90;

const WATCHER_NAME = "backup-to-gdrive";

type Sup = ReturnType<typeof createClient>;

function svc(): Sup {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function gdHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GD_KEY,
    ...extra,
  };
}

async function gdJson(path: string, init: RequestInit = {}) {
  const r = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { ...gdHeaders({ "Content-Type": "application/json" }), ...(init.headers as any) },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Drive ${path} [${r.status}]: ${txt.slice(0, 500)}`);
  return txt ? JSON.parse(txt) : {};
}

async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const parentQ = parentId ? ` and '${parentId}' in parents` : "";
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentQ}`,
  );
  const list = await gdJson(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`);
  if (list.files?.[0]?.id) return list.files[0].id;
  const created = await gdJson(`/drive/v3/files`, {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return created.id;
}

async function uploadFile(
  name: string,
  parentId: string,
  contentType: string,
  bytes: Uint8Array | string,
): Promise<string> {
  const meta = { name, parents: [parentId] };
  const boundary = "----lovableboundary" + crypto.randomUUID();
  const enc = new TextEncoder();
  const pre = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const post = enc.encode(`\r\n--${boundary}--`);
  const body = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  const full = new Uint8Array(pre.length + body.length + post.length);
  full.set(pre, 0);
  full.set(body, pre.length);
  full.set(post, pre.length + body.length);

  const r = await fetch(`${GATEWAY}/upload/drive/v3/files?uploadType=multipart`, {
    method: "POST",
    headers: gdHeaders({ "Content-Type": `multipart/related; boundary=${boundary}` }),
    body: full,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Drive upload [${r.status}]: ${txt.slice(0, 500)}`);
  return JSON.parse(txt).id;
}

async function fileExistsInFolder(name: string, parentId: string): Promise<boolean> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`,
  );
  const list = await gdJson(`/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`);
  return !!list.files?.[0]?.id;
}

async function trashFile(fileId: string) {
  await gdJson(`/drive/v3/files/${fileId}`, {
    method: "PATCH",
    body: JSON.stringify({ trashed: true }),
  });
}

async function exportTableToJson(supabase: Sup, table: string): Promise<string> {
  const pageSize = 1000;
  let from = 0;
  const rows: unknown[] = [];
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`export ${table}: ${error.message}`);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return JSON.stringify({ table, exported_at: new Date().toISOString(), count: rows.length, rows }, null, 2);
}

async function mirrorBucket(
  supabase: Sup,
  bucket: string,
  driveFolderId: string,
  log: (m: string) => void,
  deadline: number,
): Promise<{ copied: number; skipped: number; errors: number; done: boolean }> {
  const out = { copied: 0, skipped: 0, errors: 0, done: true };
  const walk = async (prefix: string): Promise<boolean> => {
    let offset = 0;
    while (true) {
      if (Date.now() > deadline) { out.done = false; return false; }
      const { data, error } = await supabase.storage.from(bucket).list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
      if (!data?.length) break;
      for (const item of data) {
        if (Date.now() > deadline) { out.done = false; return false; }
        const full = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null || (!item.metadata && item.name && !item.name.includes("."))) {
          const ok = await walk(full);
          if (!ok) return false;
          continue;
        }
        const flatName = full.replace(/\//g, "__");
        try {
          if (await fileExistsInFolder(flatName, driveFolderId)) {
            out.skipped++;
            continue;
          }
          const dl = await supabase.storage.from(bucket).download(full);
          if (dl.error) throw dl.error;
          const buf = new Uint8Array(await dl.data.arrayBuffer());
          const ct = (item.metadata as any)?.mimetype || "application/octet-stream";
          await uploadFile(flatName, driveFolderId, ct, buf);
          out.copied++;
          if (out.copied % 10 === 0) log(`${bucket}: ${out.copied} copiados, ${out.skipped} pulados`);
        } catch (e) {
          out.errors++;
          log(`erro ${bucket}/${full}: ${(e as Error).message}`);
        }
      }
      if (data.length < 100) break;
      offset += 100;
    }
    return true;
  };
  await walk("");
  return out;
}


async function cleanupOldSnapshots(dataFolderId: string): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
  const q = encodeURIComponent(
    `'${dataFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and createdTime < '${cutoff}'`,
  );
  const list = await gdJson(`/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&pageSize=1000`);
  let removed = 0;
  for (const f of list.files || []) {
    try {
      await trashFile(f.id);
      removed++;
    } catch (_) { /* ignore */ }
  }
  return removed;
}

async function runBackup(supabase: Sup, log: (m: string) => void) {
  try {
    if (!LOVABLE_API_KEY || !GD_KEY) throw new Error("Credenciais do Google Drive ausentes");

    const rootId = await findOrCreateFolder(ROOT_FOLDER_NAME);
    const dataRootId = await findOrCreateFolder(DATA_FOLDER_NAME, rootId);
    const attachId = await findOrCreateFolder(ATTACH_FOLDER_NAME, rootId);
    const nfId = await findOrCreateFolder(NF_FOLDER_NAME, rootId);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotId = await findOrCreateFolder(stamp, dataRootId);

    const tables = [
      "expenses",
      "expense_items",
      "expense_attachments",
      "expense_approval_log",
      "approval_history",
      "advance_payments",
      "advance_payment_attachments",
      "nf_entrada_imports",
    ];
    const tableStats: Record<string, number> = {};
    for (const t of tables) {
      try {
        const json = await exportTableToJson(supabase, t);
        await uploadFile(`${t}.json`, snapshotId, "application/json", json);
        tableStats[t] = JSON.parse(json).count;
        log(`exportado ${t}: ${tableStats[t]} linhas`);
      } catch (e) {
        log(`falha ${t}: ${(e as Error).message}`);
        tableStats[t] = -1;
      }
    }

    const expenseAttach = await mirrorBucket(supabase, "expense-attachments", attachId, log);
    log(`expense-attachments: ${expenseAttach.copied} copiados, ${expenseAttach.skipped} já existentes, ${expenseAttach.errors} erros`);
    const nfAttach = await mirrorBucket(supabase, "nf-entrada-files", nfId, log);
    log(`nf-entrada-files: ${nfAttach.copied} copiados, ${nfAttach.skipped} já existentes, ${nfAttach.errors} erros`);

    const removed = await cleanupOldSnapshots(dataRootId);
    log(`retenção: ${removed} snapshots antigos removidos`);

    const manifest = {
      generated_at: new Date().toISOString(),
      snapshot: stamp,
      tables: tableStats,
      expense_attachments: expenseAttach,
      nf_entrada_files: nfAttach,
      retention_days: RETENTION_DAYS,
      snapshots_pruned: removed,
    };
    await uploadFile("manifest.json", snapshotId, "application/json", JSON.stringify(manifest, null, 2));
    await releaseWatcherLock(supabase, WATCHER_NAME, "ok", `snapshot ${stamp}`);
    log(`FIM snapshot ${stamp}`);
  } catch (e) {
    const msg = (e as Error).message;
    log(`ERRO: ${msg}`);
    await releaseWatcherLock(supabase, WATCHER_NAME, "error", msg);
  }
}

// @ts-ignore - EdgeRuntime é disponível no runtime Deno da Supabase
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = svc();
  const locked = await tryWatcherLock(supabase, WATCHER_NAME, 60);
  if (!locked) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "another run in progress" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const log = (m: string) => console.log(m);
  const task = runBackup(supabase, log);

  // roda em background para não estourar o timeout de 150s da resposta HTTP
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);

  return new Response(
    JSON.stringify({ ok: true, started: true, message: "Backup em execução em segundo plano. Acompanhe pelos logs." }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

