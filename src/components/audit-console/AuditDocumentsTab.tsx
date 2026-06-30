import { useRef, useState } from "react";
import { FileSearch, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuditDocuments, useAuditRuns, useUploadAuditDocument, type AuditDocument } from "@/hooks/useAuditConsole";
import { useToast } from "@/hooks/use-toast";

const STATUS_TONE: Record<AuditDocument["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  analyzing: "bg-primary/15 text-primary",
  analyzed: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

export function AuditDocumentsTab() {
  const { toast } = useToast();
  const { data: runs } = useAuditRuns(20);
  const [runId, setRunId] = useState<string>("");
  const [docType, setDocType] = useState<"nf" | "contract" | "other">("nf");
  const { data: docs, isLoading } = useAuditDocuments(runId || undefined);
  const upload = useUploadAuditDocument();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync({ file, runId: runId || undefined, docType });
      } catch (e) {
        toast({
          title: `Falha em ${file.name}`,
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      }
    }
    toast({ title: "Upload concluído", description: "A IA está analisando os documentos." });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <FileSearch className="h-5 w-5" /> Análise documental
        </h2>
        <p className="text-sm text-muted-foreground">
          Envie NF-e (XML), boletos ou contratos em PDF. A IA extrai os dados e confronta com o SAP.
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-card/60 p-4 md:grid-cols-[1fr_180px_180px_auto]">
        <Select value={runId || "none"} onValueChange={(v) => setRunId(v === "none" ? "" : v)}>
          <SelectTrigger><SelectValue placeholder="Vincular a uma auditoria…" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem vínculo</SelectItem>
            {(runs ?? []).map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {new Date(r.started_at).toLocaleDateString("pt-BR")} • {r.id.slice(0, 8)} • {r.status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={docType} onValueChange={(v) => setDocType(v as typeof docType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nf">Nota fiscal</SelectItem>
            <SelectItem value="contract">Contrato</SelectItem>
            <SelectItem value="other">Outro</SelectItem>
          </SelectContent>
        </Select>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.xml,.txt"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando…</> : <><Upload className="mr-2 h-4 w-4" />Enviar arquivos</>}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card/60">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : !docs || docs.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Nenhum documento enviado ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{d.original_filename ?? d.storage_path}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {d.doc_type.toUpperCase()} • {new Date(d.created_at).toLocaleString("pt-BR")}
                    {d.divergences_created > 0 && <> • <span className="text-amber-400">{d.divergences_created} divergências</span></>}
                  </p>
                  {d.error_message && <p className="mt-0.5 text-xs text-destructive">{d.error_message}</p>}
                  {d.status === "analyzed" && d.extracted && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {(d.extracted as Record<string, unknown>).vendor_name as string ?? ""}
                      {" • "}
                      Total: {String((d.extracted as Record<string, unknown>).total ?? "—")}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className={`${STATUS_TONE[d.status]} border-0`}>{d.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
