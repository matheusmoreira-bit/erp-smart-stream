import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Database, HardDrive, Cloud, AlertTriangle } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { GDriveBackupPanel } from "@/components/GDriveBackupPanel";
import { toast } from "sonner";

type BackupRow = {
  id: string;
  kind: "db" | "storage";
  status: "running" | "ok" | "error" | "partial";
  trigger: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  bucket: string | null;
  s3_prefix: string | null;
  tables_count: number | null;
  objects_count: number | null;
  total_bytes: number | null;
  error_message: string | null;
};

const fmtBytes = (n: number | null) => {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const fmtDuration = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

const statusColor = (s: string) =>
  s === "ok" ? "bg-emerald-500/20 text-emerald-400" :
  s === "partial" ? "bg-amber-500/20 text-amber-400" :
  s === "error" ? "bg-red-500/20 text-red-400" :
  "bg-blue-500/20 text-blue-400";

export default function InfraHealth() {
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningDb, setRunningDb] = useState(false);
  const [runningStorage, setRunningStorage] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("infra_backup_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(30);
    if (error) toast.error(error.message);
    setRows((data as BackupRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runBackup = async (fn: "db-backup-s3" | "storage-mirror-s3") => {
    const setter = fn === "db-backup-s3" ? setRunningDb : setRunningStorage;
    setter(true);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body: { manual: true } });
      if (error) throw error;
      toast.success(`Backup iniciado: ${JSON.stringify(data).slice(0, 120)}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Falha ao executar backup");
    } finally {
      setter(false);
    }
  };

  const lastDb = rows.find((r) => r.kind === "db");
  const lastStorage = rows.find((r) => r.kind === "storage");

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <BackofficePageHeader
        title="Infra & Backups (AWS S3)"
        description="Backups do banco e storage espelhados para S3 (portabilidade AWS)."
        icon={<Cloud className="h-5 w-5 text-muted-foreground" />}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-2">Atualizar</span>
          </Button>
        }
      />

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-4 h-4" /> Backup do Banco (diário)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastDb ? (
              <div className="text-sm space-y-1">
                <div>Último: <Badge className={statusColor(lastDb.status)}>{lastDb.status}</Badge> {new Date(lastDb.started_at).toLocaleString("pt-BR")}</div>
                <div className="text-muted-foreground">Tabelas: {lastDb.tables_count ?? "—"} · Tamanho: {fmtBytes(lastDb.total_bytes)} · Duração: {fmtDuration(lastDb.duration_ms)}</div>
                {lastDb.s3_prefix && <div className="text-xs text-muted-foreground">s3://{lastDb.bucket}/{lastDb.s3_prefix}/</div>}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Nenhum backup registrado ainda. Configure os segredos AWS e execute manualmente.
              </div>
            )}
            <Button size="sm" onClick={() => runBackup("db-backup-s3")} disabled={runningDb}>
              {runningDb && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Rodar backup agora
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="w-4 h-4" /> Mirror de Storage (semanal)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastStorage ? (
              <div className="text-sm space-y-1">
                <div>Último: <Badge className={statusColor(lastStorage.status)}>{lastStorage.status}</Badge> {new Date(lastStorage.started_at).toLocaleString("pt-BR")}</div>
                <div className="text-muted-foreground">Objetos: {lastStorage.objects_count ?? "—"} · Tamanho: {fmtBytes(lastStorage.total_bytes)} · Duração: {fmtDuration(lastStorage.duration_ms)}</div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Nenhum mirror registrado ainda.</div>
            )}
            <Button size="sm" onClick={() => runBackup("storage-mirror-s3")} disabled={runningStorage}>
              {runningStorage && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Rodar mirror agora
            </Button>
          </CardContent>
        </Card>
      </div>

      <GDriveBackupPanel />


      <Card>
        <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Tabelas/Objetos</TableHead>
                <TableHead>Tamanho</TableHead>
                <TableHead>Erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Badge variant="outline">{r.kind}</Badge></TableCell>
                  <TableCell><Badge className={statusColor(r.status)}>{r.status}</Badge></TableCell>
                  <TableCell>{r.trigger}</TableCell>
                  <TableCell className="text-xs">{new Date(r.started_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell>{fmtDuration(r.duration_ms)}</TableCell>
                  <TableCell>{r.tables_count ?? r.objects_count ?? "—"}</TableCell>
                  <TableCell>{fmtBytes(r.total_bytes)}</TableCell>
                  <TableCell className="text-xs text-red-400 max-w-xs truncate" title={r.error_message ?? ""}>{r.error_message ?? "—"}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && !loading && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Sem execuções ainda.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Segredos AWS necessários</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1 text-muted-foreground">
          <p>Para ativar: adicione em <b>Cloud → Secrets</b> os valores <code>AWS_ACCESS_KEY_ID</code>, <code>AWS_SECRET_ACCESS_KEY</code>, <code>AWS_REGION</code> e <code>AWS_S3_BACKUP_BUCKET</code>, então agende os crons diário (banco) e semanal (storage). Documentação: <code>docs/aws-portability.md</code>.</p>
        </CardContent>
      </Card>
    </div>
  );
}
