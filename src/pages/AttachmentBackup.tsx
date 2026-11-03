import { useEffect, useRef, useState } from "react";
import { zip } from "fflate";
import { Archive, Download, ExternalLink, Loader2, RefreshCw, RotateCcw, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { BUCKETS, driveFolderFor, fileKey, zipPath, splitParts, retryFile, downloadZip, PART_BYTES, type BackupFile, type Bucket } from "@/lib/attachment-backup";

type Inventory = { bucket: Bucket; files: BackupFile[]; error?: string };
type Ready = { blob: Blob; name: string; files: BackupFile[] };
const DRIVE_URL = "https://drive.google.com/drive/folders/0AEGlkXe3D_4wUk9PVA";
const message = (e: unknown) => e instanceof Error ? e.message : "Falha na operação";

async function requireAdmin() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Sessão expirada");
  const role = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (role.error || role.data !== true) throw new Error("Acesso negado: administrador com MFA obrigatório");
  return user.id;
}

async function inventory(bucket: Bucket): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  const folders = [""];
  const seen = new Set<string>();
  while (folders.length) {
    const folder = folders.shift();
    if (folder === undefined || seen.has(folder)) continue;
    seen.add(folder);
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(error.message);
      for (const item of data) {
        const name = folder ? `${folder}/${item.name}` : item.name;
        if (!item.id && !item.metadata) { folders.push(name); continue; }
        const bytes = Number(item.metadata?.size);
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Tamanho de arquivo indisponível");
        files.push({ bucket, name, bytes, version: item.updated_at || item.id || "" });
      }
      if (data.length < 100) break;
    }
  }
  return files;
}

async function audit(action: string, files: BackupFile[]) {
  await requireAdmin();
  const { error } = await supabase.rpc("insert_audit_log", {
    p_action: action, p_entity_type: "attachment_backup",
    p_details: { files: files.map(f => ({ bucket: f.bucket, name: f.name, bytes: f.bytes })), count: files.length },
  });
  if (error) throw new Error("Não foi possível registrar a operação de download");
}

export default function AttachmentBackup() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Inventory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failures, setFailures] = useState<string[]>([]);
  const [ready, setReady] = useState<Ready | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const cancelled = useRef(false);
  const owner = useRef<string | null>(null);
  const checkpoint = user ? `attachment-backup:${user.id}` : null;
  useEffect(() => {
    owner.current = user?.id ?? null;
    setReady(null); cancelled.current = true;
    try {
      const saved: unknown = checkpoint ? JSON.parse(localStorage.getItem(checkpoint) || "[]") : [];
      setCompleted(new Set(Array.isArray(saved) ? saved.filter((s): s is string => typeof s === "string") : []));
    } catch { setCompleted(new Set()); }
    return () => { cancelled.current = true; owner.current = null; };
  }, [checkpoint, user?.id]);

  const load = async () => {
    setLoading(true); setError("");
    try {
      await requireAdmin();
      const result: Inventory[] = [];
      for (const bucket of BUCKETS) {
        try { result.push({ bucket, files: await inventory(bucket) }); }
        catch (e) { result.push({ bucket, files: [], error: message(e) }); }
      }
      setRows(result);
    } catch (e) { setError(message(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const prepare = async (bucket?: Bucket) => {
    if (busy || ready) return;
    setBusy(true); setFailures([]); cancelled.current = false;
    const requestOwner = user?.id;
    try {
      if (!requestOwner || await requireAdmin() !== requestOwner) throw new Error("Sessão alterada");
      const remaining = rows.filter(r => !r.error && (!bucket || r.bucket === bucket)).flatMap(r => r.files).filter(f => !completed.has(fileKey(f)));
      const { parts, rejected } = splitParts(remaining);
      setFailures(rejected.map(f => `${f.bucket}/${f.name}: tamanho acima do limite, caminho inválido ou duplicado`));
      const part = parts[0];
      if (!part) { toast.info("Nenhum arquivo autorizado restante"); return; }
      setProgress({ done: 0, total: part.length });
      const input: Record<string, Uint8Array> = Object.create(null);
      const downloaded: BackupFile[] = [];
      for (const file of part) {
        if (cancelled.current || owner.current !== requestOwner) break;
        try {
          const blob = await retryFile(async () => {
            if (await requireAdmin() !== requestOwner) throw new Error("Sessão alterada");
            const { data, error: downloadError } = await supabase.storage.from(file.bucket).download(file.name);
            if (downloadError || !data) throw new Error(downloadError?.message || "Arquivo indisponível");
            if (data.size !== file.bytes) throw new Error("Arquivo mudou; atualize a lista antes de baixar");
            return data;
          }, () => cancelled.current || owner.current !== requestOwner);
          if (cancelled.current || owner.current !== requestOwner) break;
          input[zipPath(file)] = new Uint8Array(await blob.arrayBuffer()); downloaded.push(file);
        } catch (e) { setFailures(old => [...old, `${file.bucket}/${file.name}: ${message(e)}`]); }
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
      if (cancelled.current || owner.current !== requestOwner || !downloaded.length) return;
      const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(input, { level: 0 }, (e, data) => e ? reject(e) : resolve(data)));
      if (bytes.length > PART_BYTES) throw new Error("ZIP excedeu o limite de 200 MB");
      await audit("attachment_backup_prepared", downloaded);
      if (cancelled.current || owner.current !== requestOwner) return;
      setReady({ blob: new Blob([new Uint8Array(bytes).buffer], { type: "application/zip" }), name: `erp-flow-${bucket || "anexos"}-${Date.now()}.zip`, files: downloaded });
    } catch (e) { toast.error(message(e)); }
    finally { setBusy(false); }
  };

  const save = () => {
    if (!ready || !checkpoint || owner.current !== user?.id) return;
    downloadZip(ready.blob, ready.name);
    void audit("attachment_backup_download_requested", ready.files).catch(e => toast.error(message(e)));
    const next = new Set([...completed, ...ready.files.map(fileKey)]);
    setCompleted(next);
    try { localStorage.setItem(checkpoint, JSON.stringify([...next])); }
    catch { toast.error("Retomada local indisponível; mantenha esta página aberta"); }
    setReady(null);
  };
  const available = rows.some(r => !r.error && r.files.some(f => !completed.has(fileKey(f))));
  return <div className="min-h-screen bg-background text-foreground">
    <BackofficePageHeader title="Backup de anexos" icon={<Archive className="h-4 w-4" />} actions={<Button variant="ghost" size="icon" aria-label="Atualizar inventário" title="Atualizar inventário" disabled={loading || busy || !!ready} onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button>} />
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Backup de anexos</h1><p className="mt-1 text-sm text-muted-foreground">ZIPs de até 200 MB · {completed.size} arquivos com download solicitado</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={busy || !!ready || !completed.size} onClick={() => { setCompleted(new Set()); if (checkpoint) localStorage.removeItem(checkpoint); }}><RotateCcw className="mr-2 h-4 w-4" />Reiniciar</Button><Button disabled={loading || busy || !!ready || !available} onClick={() => void prepare()}><Archive className="mr-2 h-4 w-4" />Preparar todos os permitidos</Button></div>
      </div>
      <p className="text-sm text-muted-foreground">Extraia o ZIP e arraste a pasta para ERP-Flow-Backup no <a className="inline-flex items-center gap-1 text-primary underline" href={DRIVE_URL} target="_blank" rel="noreferrer">Drive compartilhado<ExternalLink className="h-3 w-3" /></a>.</p>
      <p className="text-sm text-muted-foreground">Status no Drive indisponível para esta sessão. Os ZIPs incluem arquivos autorizados, não apenas pendentes.</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {loading ? <div role="status" className="flex items-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Conferindo arquivos autorizados…</div> : <div className="overflow-x-auto border-y border-border"><table className="w-full text-left text-sm"><thead className="bg-muted/40 text-muted-foreground"><tr>{["Bucket", "Arquivos / MB", "No Drive", "Destino", ""].map((text, i) => <th key={i} className="px-3 py-3 font-medium">{text}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map(row => <tr key={row.bucket}><td className="px-3 py-4"><span className="break-all font-medium">{row.bucket}</span>{row.error && <div className="mt-1 max-w-64 text-xs text-destructive">{row.error}</div>}</td><td className="whitespace-nowrap px-3 py-4">{row.error ? "—" : `${row.files.length} / ${(row.files.reduce((s, f) => s + f.bytes, 0) / 1048576).toFixed(1)}`}</td><td className="px-3 py-4">—</td><td className="px-3 py-4"><span className="break-all text-xs text-muted-foreground">{driveFolderFor(row.bucket)}</span></td><td className="px-3 py-4">{row.error ? <Badge variant="outline">Bloqueado</Badge> : <Button variant="outline" size="sm" disabled={busy || !!ready || !row.files.some(f => !completed.has(fileKey(f)))} onClick={() => void prepare(row.bucket)}><Archive className="mr-2 h-4 w-4" />Preparar ZIP</Button>}</td></tr>)}</tbody></table></div>}
      {(busy || ready) && <section className="space-y-3 border-y border-border py-4" aria-live="polite"><div className="flex flex-wrap items-center justify-between gap-3"><span>{busy ? `Preparando ${progress.done} de ${progress.total}` : `ZIP pronto · ${ready?.files.length} arquivos · ${((ready?.blob.size || 0) / 1048576).toFixed(1)} MB`}</span>{busy ? <Button variant="outline" onClick={() => { cancelled.current = true; }}><Square className="mr-2 h-4 w-4" />Cancelar</Button> : <Button onClick={save}><Download className="mr-2 h-4 w-4" />Baixar ZIP</Button>}</div><Progress value={progress.total ? progress.done / progress.total * 100 : 0} /></section>}
      {failures.length > 0 && <section className="space-y-2"><h2 className="font-medium text-destructive">Arquivos não incluídos ({failures.length})</h2><ul className="max-h-64 space-y-1 overflow-auto text-sm text-muted-foreground">{failures.map((f, i) => <li className="break-all" key={i}>{f}</li>)}</ul></section>}
    </main>
  </div>;
}