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

// Pasta raiz: usa GDRIVE_BACKUP_FOLDER_ID se configurado; caso contrário
// resolve/cria "ERP-Flow-Backups" no Drive da conta conectada.
const ROOT_FOLDER_ID = Deno.env.get("GDRIVE_BACKUP_FOLDER_ID") || "";
const ROOT_FOLDER_NAME = "ERP-Flow-Backups";
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

async function getConfiguredFolderId(supabase: Sup): Promise<string> {
  try {
    const { data } = await supabase
      .from("gdrive_backup_settings")
      .select("folder_id")
      .eq("singleton", true)
      .maybeSingle();
    return ((data as any)?.folder_id as string) || "";
  } catch (_) {
    return "";
  }
}

async function resolveRootFolder(log: (m: string) => void, supabase: Sup): Promise<string> {
  const configured = (await getConfiguredFolderId(supabase)) || ROOT_FOLDER_ID;
  if (configured) {
    try {
      const f = await gdJson(`/drive/v3/files/${configured}?fields=id,trashed`);
      if (f?.id && !f.trashed) return f.id;
      log(`pasta configurada ${configured} está na lixeira — usando fallback`);
    } catch (e) {
      log(`pasta configurada inacessível (${(e as Error).message.slice(0, 120)}) — usando fallback`);
    }
  }
  const id = await findOrCreateFolder(ROOT_FOLDER_NAME);
  log(`pasta raiz de backup: ${ROOT_FOLDER_NAME} (${id})`);
  return id;
}

async function setRunState(supabase: Sup, patch: Record<string, unknown>) {
  try {
    await supabase.from("gdrive_backup_settings").update(patch).eq("singleton", true);
  } catch (_) { /* ignore */ }
}

async function runBackup(supabase: Sup, log: (m: string) => void) {
  try {
    if (!LOVABLE_API_KEY || !GD_KEY) throw new Error("Credenciais do Google Drive ausentes");

    const rootId = await resolveRootFolder(log, supabase);


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

    const deadline = Date.now() + 240_000; // 4 min de wall budget para mirrors
    const expenseAttach = await mirrorBucket(supabase, "expense-attachments", attachId, log, deadline);
    log(`expense-attachments: ${expenseAttach.copied} copiados, ${expenseAttach.skipped} pulados, ${expenseAttach.errors} erros, done=${expenseAttach.done}`);
    const nfAttach = await mirrorBucket(supabase, "nf-entrada-files", nfId, log, deadline);
    log(`nf-entrada-files: ${nfAttach.copied} copiados, ${nfAttach.skipped} pulados, ${nfAttach.errors} erros, done=${nfAttach.done}`);

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
    const complete = expenseAttach.done && nfAttach.done;
    await releaseWatcherLock(
      supabase,
      WATCHER_NAME,
      complete ? "ok" : "partial",
      complete ? `snapshot ${stamp}` : `snapshot ${stamp} parcial — próxima execução continua`,
    );
    await setRunState(supabase, {
      run_status: complete ? "ok" : "partial",
      run_progress: `Concluído: ${Object.keys(tableStats).length} tabelas, ${expenseAttach.copied + nfAttach.copied} anexos novos`,
      run_finished_at: new Date().toISOString(),
      last_snapshot: stamp,
      run_error: null,
    });
    log(`FIM snapshot ${stamp} (complete=${complete})`);
  } catch (e) {
    const msg = (e as Error).message;
    log(`ERRO: ${msg}`);
    await releaseWatcherLock(supabase, WATCHER_NAME, "error", msg);
    await setRunState(supabase, {
      run_status: "error",
      run_progress: "Falhou",
      run_finished_at: new Date().toISOString(),
      run_error: msg,
    });
  }

}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

async function requireAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user) return false;
  const { data: isAdmin } = await client.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
  return isAdmin === true;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = svc();

  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const action = String(body?.action || "run");

  // Ações administrativas (consulta e configuração de pasta)
  if (action !== "run") {
    if (!(await requireAdmin(req))) return json({ error: "Acesso restrito a administradores" }, 403);

    if (action === "status") {
      const { data: settings } = await supabase
        .from("gdrive_backup_settings").select("*").eq("singleton", true).maybeSingle();
      const { data: run } = await supabase
        .from("watcher_runs").select("*").eq("watcher_name", WATCHER_NAME).maybeSingle();
      return json({ settings, run });
    }

    if (action === "list_folders") {
      if (!LOVABLE_API_KEY || !GD_KEY) return json({ error: "Google Drive não conectado" }, 400);
      const parentId = typeof body.parent_id === "string" && body.parent_id ? body.parent_id : "root";
      const search = typeof body.search === "string" ? body.search.trim().slice(0, 100) : "";
      const esc = (s: string) => s.replace(/['\\]/g, "\\$&");
      const q = search
        ? `mimeType='application/vnd.google-apps.folder' and trashed=false and name contains '${esc(search)}'`
        : `mimeType='application/vnd.google-apps.folder' and trashed=false and '${esc(parentId)}' in parents`;
      try {
        const list = await gdJson(
          `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink,parents)&pageSize=100&orderBy=name`,
        );
        return json({ folders: list.files || [], parent_id: parentId });
      } catch (e) {
        return json({ error: (e as Error).message }, 502);
      }
    }

    if (action === "create_folder") {
      if (!LOVABLE_API_KEY || !GD_KEY) return json({ error: "Google Drive não conectado" }, 400);
      const name = String(body.name || "").trim().slice(0, 120);
      if (!name) return json({ error: "Informe o nome da pasta" }, 400);
      const parentId = typeof body.parent_id === "string" && body.parent_id ? body.parent_id : undefined;
      try {
        const id = await findOrCreateFolder(name, parentId);
        return json({ id, name });
      } catch (e) {
        return json({ error: (e as Error).message }, 502);
      }
    }

    if (action === "validate_folder") {
      const folderId = String(body.folder_id || "").trim();
      if (!folderId) return json({ error: "Informe o ID da pasta" }, 400);
      try {
        const f = await gdJson(`/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed,webViewLink`);
        if (f.mimeType !== "application/vnd.google-apps.folder") return json({ error: "O ID informado não é uma pasta" }, 400);
        if (f.trashed) return json({ error: "A pasta está na lixeira" }, 400);
        return json({ folder: f });
      } catch (e) {
        return json({ error: (e as Error).message }, 502);
      }
    }

    return json({ error: "Ação inválida" }, 400);
  }

  const locked = await tryWatcherLock(supabase, WATCHER_NAME, 60);
  if (!locked) {
    return json({ skipped: true, reason: "another run in progress", message: "Já existe um backup em execução." });
  }

  const trigger = body?.manual === true ? "manual" : "cron";
  await setRunState(supabase, {
    run_status: "running",
    run_progress: "Iniciando…",
    run_started_at: new Date().toISOString(),
    run_finished_at: null,
    run_trigger: trigger,
    run_error: null,
  });

  const log = (m: string) => {
    console.log(m);
    setRunState(supabase, { run_progress: m.slice(0, 500) });
  };
  const task = runBackup(supabase, log);

  // roda em background para não estourar o timeout de 150s da resposta HTTP
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);

  return json({ ok: true, started: true, trigger, message: "Backup em execução em segundo plano." });
});
