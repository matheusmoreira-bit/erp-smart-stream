import { useState } from "react";
import { Loader2, PlayCircle, RefreshCw, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  usePayQueue,
  useEnqueuePayAudit,
  useProcessPayQueue,
  useRequeuePayItem,
  useRunPayAudit,
} from "@/hooks/useAuditPay";
import { QueueStatusBadge } from "./badges";

export function PayAuditQueue() {
  const [status, setStatus] = useState<string>("");
  const [docRef, setDocRef] = useState("");
  const { data, isLoading, refetch } = usePayQueue(status || undefined);
  const enqueue = useEnqueuePayAudit();
  const process = useProcessPayQueue();
  const requeue = useRequeuePayItem();
  const runOne = useRunPayAudit();

  const statuses = [
    { key: "", label: "Todos" },
    { key: "pending", label: "Na fila" },
    { key: "processing", label: "Processando" },
    { key: "done", label: "Concluídos" },
    { key: "error", label: "Erro" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Fila de auditoria</h2>
          <p className="text-sm text-muted-foreground">
            Documentos aguardando comparação entre aprovação e pagamento.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              enqueue.mutate(30, {
                onSuccess: (r: any) => toast({ title: "Fila atualizada", description: `${r?.enqueued ?? 0} documentos enfileirados.` }),
                onError: (e: any) => toast({ title: "Falha ao enfileirar", description: e.message, variant: "destructive" }),
              })
            }
            disabled={enqueue.isPending}
          >
            {enqueue.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ListPlus className="mr-2 h-4 w-4" />}
            Enfileirar (30 dias)
          </Button>
          <Button
            onClick={() =>
              process.mutate(10, {
                onSuccess: (r: any) => toast({ title: "Processamento concluído", description: `${r?.processed ?? 0} documentos auditados.` }),
                onError: (e: any) => toast({ title: "Falha no processamento", description: e.message, variant: "destructive" }),
              })
            }
            disabled={process.isPending}
          >
            {process.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
            Processar fila
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 p-3">
        <Input
          value={docRef}
          onChange={(e) => setDocRef(e.target.value)}
          placeholder="Auditar documento avulso (ex.: PurchaseInvoices:1234)"
          className="max-w-md"
        />
        <Button
          variant="secondary"
          disabled={!docRef.trim() || runOne.isPending}
          onClick={() =>
            runOne.mutate(
              { documentRef: docRef.trim() },
              {
                onSuccess: (r: any) => toast({ title: "Auditoria concluída", description: `${r?.findings ?? 0} divergências (${r?.overall_severity}).` }),
                onError: (e: any) => toast({ title: "Falha na auditoria", description: e.message, variant: "destructive" }),
              },
            )
          }
        >
          {runOne.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
          Auditar agora
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {statuses.map((s) => (
          <button
            key={s.key}
            onClick={() => setStatus(s.key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              status === s.key ? "border-primary/30 bg-primary/15 text-primary" : "border-transparent bg-muted/40 text-muted-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card/60">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Nenhum item na fila.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-foreground">{item.document_ref}</span>
                    <QueueStatusBadge status={item.status} />
                    <span className="rounded border border-border bg-muted/40 px-1.5 text-[10px] uppercase text-muted-foreground">
                      prio {item.priority}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    <span>{new Date(item.enqueued_at).toLocaleString("pt-BR")}</span>
                    <span>{item.attempts} tentativa(s)</span>
                    <span>{item.baseline_source === "erp_flow_approval" ? "Baseline: ERP Flow" : "Baseline: Pedido SAP"}</span>
                  </div>
                  {item.error_message && (
                    <p className="mt-1 text-[11px] text-destructive">{item.error_message}</p>
                  )}
                </div>
                {(item.status === "error" || item.status === "done") && (
                  <Button size="sm" variant="outline" onClick={() => requeue.mutate(item.id)}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reprocessar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
