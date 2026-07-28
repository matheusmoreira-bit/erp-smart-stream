import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, FolderCog, FolderPlus, ChevronRight, Play, ExternalLink, Search, Home,
} from "lucide-react";

type Settings = {
  folder_id: string | null;
  folder_name: string | null;
  folder_path: string | null;
  folder_url: string | null;
  run_status: string | null;
  run_progress: string | null;
  run_started_at: string | null;
  run_finished_at: string | null;
  run_trigger: string | null;
  run_error: string | null;
  last_snapshot: string | null;
  updated_at: string | null;
};

type WatcherRun = {
  last_status: string | null;
  last_message: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  locked_at: string | null;
};

type DriveFolder = { id: string; name: string; webViewLink?: string };

const statusClass = (s?: string | null) =>
  s === "ok" ? "bg-emerald-500/15 text-emerald-500" :
  s === "partial" ? "bg-amber-500/15 text-amber-500" :
  s === "error" ? "bg-destructive/15 text-destructive" :
  s === "running" ? "bg-primary/15 text-primary" :
  "bg-muted text-muted-foreground";

const statusLabel = (s?: string | null) =>
  s === "ok" ? "Concluído" :
  s === "partial" ? "Parcial" :
  s === "error" ? "Erro" :
  s === "running" ? "Em execução" :
  "Sem execuções";

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString("pt-BR") : "—");

export function GDriveBackupPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [run, setRun] = useState<WatcherRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const pollRef = useRef<number | null>(null);

  const callFn = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("backup-to-gdrive", { body });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  }, []);

  const loadStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await callFn({ action: "status" });
      setSettings(data.settings ?? null);
      setRun(data.run ?? null);
    } catch (e: any) {
      if (!silent) toast.error(e.message || "Falha ao carregar status do backup");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [callFn]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const isRunning = settings?.run_status === "running";

  // Polling enquanto o backup está em execução
  useEffect(() => {
    if (!isRunning) {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = window.setInterval(() => loadStatus(true), 5000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [isRunning, loadStatus]);

  const startBackup = async () => {
    setStarting(true);
    try {
      const data = await callFn({ action: "run", manual: true });
      if (data?.skipped) toast.info(data.message || "Já existe um backup em execução.");
      else toast.success("Backup manual iniciado — acompanhando o progresso.");
      await loadStatus(true);
    } catch (e: any) {
      toast.error(e.message || "Falha ao iniciar o backup");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <FolderCog className="w-4 h-4" /> Backup Google Drive (a cada 6h)
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => loadStatus()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
            <FolderCog className="w-4 h-4 mr-2" /> Pasta de destino
          </Button>
          <Button size="sm" onClick={startBackup} disabled={starting || isRunning}>
            {starting || isRunning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
            {isRunning ? "Em execução" : "Backup manual"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={statusClass(settings?.run_status)}>{statusLabel(settings?.run_status)}</Badge>
          {settings?.run_trigger && <Badge variant="outline">{settings.run_trigger === "manual" ? "manual" : "agendado"}</Badge>}
          <span className="text-muted-foreground">Início: {fmt(settings?.run_started_at)}</span>
          <span className="text-muted-foreground">Fim: {fmt(settings?.run_finished_at)}</span>
        </div>

        {settings?.run_progress && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs font-mono flex items-start gap-2">
            {isRunning && <Loader2 className="w-3 h-3 animate-spin mt-0.5 shrink-0" />}
            <span className="break-words">{settings.run_progress}</span>
          </div>
        )}

        {settings?.run_error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive break-words">
            {settings.run_error}
          </div>
        )}

        <div className="text-muted-foreground space-y-1">
          <div>
            Pasta de destino:{" "}
            {settings?.folder_id ? (
              <span className="text-foreground">
                {settings.folder_name || settings.folder_id}
                {settings.folder_url && (
                  <a href={settings.folder_url} target="_blank" rel="noreferrer" className="inline-flex items-center ml-1 text-primary hover:underline">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </span>
            ) : (
              <span className="text-foreground">Automática (ERP-Flow-Backups)</span>
            )}
          </div>
          {settings?.last_snapshot && <div>Último snapshot: {settings.last_snapshot}</div>}
          {run?.last_message && <div className="text-xs">Watcher: {run.last_message}</div>}
        </div>
      </CardContent>

      <FolderConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        current={settings}
        callFn={callFn}
        onSaved={() => loadStatus(true)}
      />
    </Card>
  );
}

function FolderConfigDialog({
  open, onOpenChange, current, callFn, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: Settings | null;
  callFn: (body: Record<string, unknown>) => Promise<any>;
  onSaved: () => void;
}) {
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([{ id: "root", name: "Meu Drive" }]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DriveFolder | null>(null);
  const [manualId, setManualId] = useState("");
  const [newFolder, setNewFolder] = useState("");

  const currentParent = trail[trail.length - 1];

  const browse = useCallback(async (parentId: string, term = "") => {
    setLoading(true);
    try {
      const data = await callFn({ action: "list_folders", parent_id: parentId, search: term || undefined });
      setFolders(data.folders || []);
    } catch (e: any) {
      toast.error(e.message || "Falha ao listar pastas do Drive");
    } finally {
      setLoading(false);
    }
  }, [callFn]);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelected(null);
    setManualId(current?.folder_id || "");
    setTrail([{ id: "root", name: "Meu Drive" }]);
    browse("root");
  }, [open, current?.folder_id, browse]);

  const openFolder = (f: DriveFolder) => {
    setSearch("");
    setTrail((t) => [...t, { id: f.id, name: f.name }]);
    browse(f.id);
  };

  const goTo = (idx: number) => {
    const next = trail.slice(0, idx + 1);
    setTrail(next);
    setSearch("");
    browse(next[next.length - 1].id);
  };

  const createFolder = async () => {
    const name = newFolder.trim();
    if (!name) return;
    try {
      const data = await callFn({ action: "create_folder", name, parent_id: currentParent.id });
      toast.success(`Pasta "${name}" criada`);
      setNewFolder("");
      await browse(currentParent.id);
      setSelected({ id: data.id, name });
    } catch (e: any) {
      toast.error(e.message || "Falha ao criar pasta");
    }
  };

  const save = async (folder: DriveFolder | null) => {
    if (!folder) return;
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const path = [...trail.map((t) => t.name).slice(1), folder.name].join(" / ") || folder.name;
      const { error } = await supabase
        .from("gdrive_backup_settings")
        .update({
          folder_id: folder.id,
          folder_name: folder.name,
          folder_path: path,
          folder_url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
          updated_by: userData?.user?.id ?? null,
        })
        .eq("singleton", true);
      if (error) throw error;
      toast.success("Pasta de destino atualizada");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Falha ao salvar a pasta");
    } finally {
      setSaving(false);
    }
  };

  const useManualId = async () => {
    const id = manualId.trim();
    if (!id) return;
    try {
      const data = await callFn({ action: "validate_folder", folder_id: id });
      await save({ id: data.folder.id, name: data.folder.name, webViewLink: data.folder.webViewLink });
    } catch (e: any) {
      toast.error(e.message || "Pasta inválida");
    }
  };

  const resetToAuto = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("gdrive_backup_settings")
        .update({ folder_id: null, folder_name: null, folder_path: null, folder_url: null })
        .eq("singleton", true);
      if (error) throw error;
      toast.success("Voltou para a pasta automática (ERP-Flow-Backups)");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Falha ao redefinir");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pasta de destino do backup</DialogTitle>
          <DialogDescription>
            Escolha no Google Drive onde os snapshots e anexos serão gravados. Se nenhuma pasta for definida,
            o sistema usa/cria automaticamente a pasta <b>ERP-Flow-Backups</b>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar pasta pelo nome…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") browse(currentParent.id, search); }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => browse(currentParent.id, search)} disabled={loading}>
              Buscar
            </Button>
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
            <Home className="w-3 h-3" />
            {trail.map((t, i) => (
              <span key={t.id} className="flex items-center gap-1">
                <button className="hover:text-foreground hover:underline" onClick={() => goTo(i)}>{t.name}</button>
                {i < trail.length - 1 && <ChevronRight className="w-3 h-3" />}
              </span>
            ))}
          </div>

          <div className="border rounded-md h-64 overflow-y-auto divide-y">
            {loading && (
              <div className="p-6 flex justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}
            {!loading && folders.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma subpasta encontrada.</div>
            )}
            {!loading && folders.map((f) => (
              <div
                key={f.id}
                className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 ${selected?.id === f.id ? "bg-primary/10" : ""}`}
                onClick={() => setSelected(f)}
                onDoubleClick={() => openFolder(f)}
              >
                <span className="truncate">{f.name}</span>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openFolder(f); }}>
                  Abrir <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder={`Nova pasta dentro de "${currentParent.name}"`}
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
            />
            <Button variant="outline" size="sm" onClick={createFolder} disabled={!newFolder.trim()}>
              <FolderPlus className="w-4 h-4 mr-2" /> Criar
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Ou informe o ID/URL da pasta</Label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="ID da pasta do Google Drive"
                value={manualId}
                onChange={(e) => {
                  const v = e.target.value;
                  const m = v.match(/folders\/([A-Za-z0-9_-]+)/);
                  setManualId(m ? m[1] : v);
                }}
              />
              <Button variant="outline" size="sm" onClick={useManualId} disabled={!manualId.trim() || saving}>
                Usar este ID
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={resetToAuto} disabled={saving}>
            Usar pasta automática
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => save(selected)} disabled={!selected || saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Salvar {selected ? `"${selected.name}"` : "pasta"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
