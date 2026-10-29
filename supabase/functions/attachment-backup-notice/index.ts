// Edge function: attachment-backup-notice
// Avisa os responsáveis (e-mail + WhatsApp) sobre anexos que precisam ser copiados à mão
// do Storage para a pasta ERP-Flow-Backup no Drive compartilhado, até tudo estar copiado.
// Body: { mode: "check" | "weekly", dry_run?: boolean }. Exige scheduler/admin.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { logSend } from "../_shared/send-log.ts";
import { ARCHIVE_COMPANIES } from "../_shared/sap-archive.ts";
import { drive, putSmall } from "../export-to-gdrive/drive.ts";
import { SHARED_DRIVE } from "../export-to-gdrive/core.ts";
import { BUCKETS, bucketForDrivePath, compareBucket, decide, sapInitialLoadDone, type Bucket, type BucketStat, type Item, type Mode } from "./core.ts";

const SOURCE = "attachment-backup-notice";
const RECIPIENTS = ["hiller.brandao@growth.gg", "douglas.vinicius@growth.gg"];
const WHATSAPP_URL = Deno.env.get("WHATSAPP_URL") || "http://63.177.171.140/sender_wpp";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN") || "";
const cors = { "Access-Control-Allow-Origin": "https://erp-flow.cactuscorporation.com", "Access-Control-Allow-Headers": "authorization,content-type,x-scheduler-secret" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function listDrive(rootId: string): Promise<Map<Bucket, Item[]>> {
  type F = { id: string; name: string; size?: string; parents?: string[]; mimeType: string };
  const all: F[] = []; let token = "";
  for (let i = 0; i < 100; i++) {
    const p = new URLSearchParams({ q: "trashed=false", corpora: "drive", driveId: SHARED_DRIVE, includeItemsFromAllDrives: "true", fields: "nextPageToken,files(id,name,size,parents,mimeType)", pageSize: "1000" });
    if (token) p.set("pageToken", token);
    const r = await drive(`/drive/v3/files?${p}`);
    all.push(...((r.files as F[]) || []));
    token = String(r.nextPageToken || ""); if (!token) break;
  }
  const folders = new Map(all.filter((f) => f.mimeType === "application/vnd.google-apps.folder").map((f) => [f.id, f]));
  const pathOf = (f: F): string[] | null => {
    const segs: string[] = []; let parent = f.parents?.[0];
    for (let d = 0; d < 20 && parent; d++) {
      if (parent === rootId) return segs.reverse();
      const pf = folders.get(parent); if (!pf) return null;
      segs.push(pf.name); parent = pf.parents?.[0];
    }
    return null;
  };
  const out = new Map<Bucket, Item[]>(BUCKETS.map((b) => [b, []]));
  for (const f of all) {
    if (f.mimeType === "application/vnd.google-apps.folder") continue;
    const segs = pathOf(f); if (!segs) continue;
    const b = bucketForDrivePath(segs); if (b) out.get(b)!.push({ name: f.name, bytes: Number(f.size || 0) });
  }
  return out;
}

function buildEmail(kind: string, link: string, stats: BucketStat[], sapDone: boolean) {
  const pending = stats.filter((s) => !s.complete);
  if (kind === "final") {
    const subject = "Backup de anexos concluído — ERP Flow";
    const text = `Todos os anexos estão na pasta ERP-Flow-Backup do Drive (${link}). Os avisos foram encerrados.`;
    return { subject, text, html: `<p>Todos os anexos já estão na pasta <a href="${esc(link)}">ERP-Flow-Backup</a> do Drive compartilhado.</p><p>Os avisos semanais foram encerrados.</p>` };
  }
  const subject = `Anexos pendentes de cópia para o Drive — ${pending.length} pasta(s)`;
  const rows = pending.map((s) => `<tr><td>${esc(s.bucket)}</td><td>${s.storage_files}</td><td>${s.storage_mb.toLocaleString("pt-BR")}</td><td>${s.drive_files}</td><td>${esc(s.drive_folder)}</td></tr>`).join("");
  const steps = ["Abra o projeto ERP Flow no Lovable.", "Vá em More → Storage e abra o bucket indicado.", "Baixe os arquivos.", "Suba na subpasta correspondente da ERP-Flow-Backup, mantendo os nomes dos arquivos."];
  const warn = sapDone ? "" : "Atenção: o arquivo SAP ainda está em carga e pode crescer.";
  const html = `<p>Os anexos abaixo ainda precisam ser copiados à mão para a pasta <a href="${esc(link)}">ERP-Flow-Backup</a> no Drive compartilhado.</p>
<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Bucket</th><th>Arquivos no storage</th><th>MB</th><th>Já no Drive</th><th>Subpasta no Drive</th></tr>${rows}</table>
<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${warn ? `<p><b>${esc(warn)}</b></p>` : ""}
<p>Quando uma pasta estiver completa no Drive (mesmo nome e tamanho), ela sai deste aviso automaticamente.</p>`;
  const text = [`Anexos pendentes de cópia para o Drive: ${link}`, ...pending.map((s) => `- ${s.bucket}: ${s.storage_files} arquivos (${s.storage_mb} MB), ${s.drive_files} já no Drive → ${s.drive_folder}`), "", ...steps.map((s, i) => `${i + 1}. ${s}`), warn].filter(Boolean).join("\n");
  return { subject, text, html };
}

async function phonesFor(sb: any, emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data: mails } = await sb.from("sap_user_emails").select("user_key, email").in("email", emails);
  const keys = ((mails || []) as any[]).map((m) => m.user_key).filter(Boolean);
  const { data: dir } = keys.length ? await sb.from("sap_user_directory").select("user_key, sap_user_code").in("user_key", keys) : { data: [] };
  const codesBy = new Map<string, string[]>();
  for (const e of emails) codesBy.set(e, [e, e.split("@")[0]]);
  for (const m of (mails || []) as any[]) for (const d of (dir || []) as any[]) if (d.user_key === m.user_key && d.sap_user_code) codesBy.get(String(m.email).toLowerCase())?.push(d.sap_user_code);
  const { data: phones } = await sb.from("user_phones").select("user_code, phone").limit(10000);
  for (const [e, codes] of codesBy) {
    const set = new Set(codes.map((c) => c.toLowerCase()));
    const hit = ((phones || []) as any[]).find((p) => set.has(String(p.user_code || "").toLowerCase()) && String(p.phone || "").replace(/\D/g, "").length >= 10);
    if (hit) out.set(e, String(hit.phone).replace(/\D/g, ""));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = await requireSchedulerOrAdmin(req, cors);
  if (!auth.ok) return auth.response!;
  let body: any = {}; try { body = await req.json(); } catch { /* sem corpo */ }
  const mode: Mode = body?.mode === "weekly" ? "weekly" : "check";
  const dryRun = body?.dry_run === true;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { data: st } = await sb.from("gdrive_export_state").select("state").eq("singleton", true).maybeSingle();
    const rootId = String((st?.state as any)?.root || "");
    if (!rootId) return json({ ok: false, error: "Pasta ERP-Flow-Backup ainda não criada pela exportação" }, 409);
    const link = `https://drive.google.com/drive/folders/${rootId}`;
    const { data: notice } = await sb.from("gdrive_attachment_notice_state").select("*").eq("singleton", true).maybeSingle();

    const { data: inv, error: invErr } = await sb.rpc("storage_backup_inventory", { p_buckets: [...BUCKETS] });
    if (invErr) throw new Error("Falha ao ler inventário do storage");
    const storageBy = new Map<Bucket, Item[]>(BUCKETS.map((b) => [b, []]));
    for (const r of (inv || []) as any[]) storageBy.get(r.bucket_id)?.push({ name: r.name, bytes: Number(r.bytes || 0) });
    const driveBy = await listDrive(rootId);
    const stats = BUCKETS.map((b) => compareBucket(b, storageBy.get(b)!, driveBy.get(b)!));

    const { data: cursors } = await sb.from("sap_archive_cursors").select("company_db, completed").in("company_db", [...ARCHIVE_COMPANIES]);
    const { count: pendingAtt } = await sb.from("sap_archive_attachments").select("id", { count: "exact", head: true }).in("company_db", [...ARCHIVE_COMPANIES]).eq("status", "pending");
    const sapDone = sapInitialLoadDone(ARCHIVE_COMPANIES, (cursors || []) as any[], pendingAtt || 0);
    const allComplete = stats.every((s) => s.complete);
    const decision = decide(mode, { allComplete, sapDone, initialSent: !!notice?.initial_sent_at, completed: !!notice?.completed_at });
    const preview = buildEmail(decision === "final" ? "final" : "pending", link, stats, sapDone);
    const phones = await phonesFor(sb, RECIPIENTS);
    const summary = { mode, decision, sap_initial_load_done: sapDone, sap_pending_attachments: pendingAtt || 0, all_complete: allComplete, buckets: stats, whatsapp_recipients: phones.size, recipients_without_phone: RECIPIENTS.filter((e) => !phones.has(e)).length };
    if (dryRun) return json({ ok: true, dry_run: true, ...summary, preview_email: { subject: preview.subject, text: preview.text } });

    const sent = { email: 0, whatsapp: 0, errors: 0 };
    if (decision !== "none") {
      const meta = { decision, mode };
      for (const to of RECIPIENTS) {
        const { error } = await sb.functions.invoke("send-smtp-email", { body: { to: [to], subject: preview.subject, html: preview.html, text: preview.text } });
        if (error) sent.errors++; else sent.email++;
        await logSend({ channel: "email", recipient: to, status: error ? "failed" : "sent", subject: preview.subject, source: SOURCE, errorMessage: error ? "falha no envio" : null, entityType: "attachment_backup_notice", metadata: meta });
        const phone = phones.get(to); if (!phone) continue;
        if (!WHATSAPP_TOKEN) { await logSend({ channel: "whatsapp", recipient: phone, status: "skipped", subject: preview.subject, source: SOURCE, errorMessage: "canal WhatsApp não configurado", entityType: "attachment_backup_notice", metadata: meta }); continue; }
        try {
          const r = await fetch(WHATSAPP_URL, { method: "POST", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ to: phone, message: `*${preview.subject}*\n\n${preview.text}` }).toString() });
          await r.body?.cancel(); if (r.ok) sent.whatsapp++; else sent.errors++;
          await logSend({ channel: "whatsapp", recipient: phone, status: r.ok ? "sent" : "failed", subject: preview.subject, source: SOURCE, errorMessage: r.ok ? null : `HTTP ${r.status}`, entityType: "attachment_backup_notice", metadata: meta });
        } catch (e) { sent.errors++; await logSend({ channel: "whatsapp", recipient: phone, status: "failed", subject: preview.subject, source: SOURCE, errorMessage: (e as Error).message.slice(0, 200), entityType: "attachment_backup_notice", metadata: meta }); }
      }
    }
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { singleton: true, last_check: summary, updated_at: now };
    if (decision === "initial" && sent.email > 0) patch.initial_sent_at = now;
    if (decision === "final" && sent.email > 0) {
      patch.completed_at = now;
      try {
        const m = await fetch(`https://connector-gateway.lovable.dev/google_drive/drive/v3/files?${new URLSearchParams({ q: `name='manifest.json' and '${rootId}' in parents and trashed=false`, corpora: "drive", driveId: SHARED_DRIVE, includeItemsFromAllDrives: "true", supportsAllDrives: "true", fields: "files(id)" })}`, { headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "X-Connection-Api-Key": Deno.env.get("GOOGLE_DRIVE_API_KEY") || "" } });
        const id = m.ok ? ((await m.json()).files?.[0]?.id) : (await m.body?.cancel(), undefined);
        if (id) {
          const c = await drive(`/drive/v3/files/${id}?alt=media`).catch(() => null);
          const manifest = { ...(c || {}), attachments_status: "concluido", attachments_completed_at: now, attachment_pending: [] };
          await putSmall("manifest.json", rootId, JSON.stringify(manifest, null, 2), "application/json");
        }
      } catch { console.error("Falha ao marcar anexos concluídos no manifest"); }
    }
    await sb.from("gdrive_attachment_notice_state").upsert(patch);
    return json({ ok: true, ...summary, sent });
  } catch (e) {
    console.error(`${SOURCE} falhou`);
    return json({ ok: false, error: (e as Error).message.slice(0, 300) }, 500);
  }
});
