import { useState } from "react";
import { CloudOff, RefreshCw, Trash2, AlertTriangle, Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOfflineOutbox } from "@/hooks/useOfflineOutbox";
import { removeOutbox } from "@/lib/offline-outbox";
import { toast } from "sonner";

function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

/**
 * Indicador da fila de envio offline: só aparece quando existe algo pendente.
 */
export function OfflineQueueIndicator() {
  const { entries, pendingCount, failedCount, isFlushing, flush } = useOfflineOutbox();
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  const handleFlush = async () => {
    const res = await flush(true);
    if (res.sent > 0) toast.success(`${res.sent} lançamento(s) enviados da fila offline.`);
    else if (res.failed > 0) toast.error("Ainda não foi possível enviar os lançamentos da fila.");
    else toast.info("Nada para enviar no momento.");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="Fila de envio offline"
          aria-label={`Fila de envio offline: ${entries.length} pendente(s)`}
        >
          <CloudOff className="w-4 h-4" />
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-warning text-[10px] font-semibold text-warning-foreground flex items-center justify-center">
            {entries.length}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-3 border-b border-border">
          <p className="text-sm font-semibold">Fila de envio offline</p>
          <p className="text-xs text-muted-foreground">
            {pendingCount} aguardando a base voltar
            {failedCount > 0 ? ` · ${failedCount} com erro` : ""}
          </p>
        </div>
        <ScrollArea className="max-h-72">
          <ul className="divide-y divide-border">
            {entries.map((e) => (
              <li key={e.id} className="p-3 flex items-start gap-2">
                {e.status === "failed" ? (
                  <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{e.summary.supplier_name || "Sem fornecedor"}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBRL(e.summary.total)} · {e.summary.itemCount} item(ns)
                    {e.summary.attachmentCount > 0 ? ` · ${e.summary.attachmentCount} anexo(s)` : ""}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px]">{e.companyDB || "—"}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  {e.lastError && (
                    <p className="text-[11px] text-destructive mt-1 line-clamp-2">{e.lastError}</p>
                  )}
                </div>
                <button
                  className="p-1 text-muted-foreground hover:text-destructive"
                  title="Descartar da fila"
                  onClick={async () => {
                    await removeOutbox(e.id);
                    toast.info("Lançamento removido da fila offline.");
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
        <div className="p-3 border-t border-border">
          <Button size="sm" className="w-full" onClick={handleFlush} disabled={isFlushing}>
            <RefreshCw className={`w-3.5 h-3.5 mr-2 ${isFlushing ? "animate-spin" : ""}`} />
            {isFlushing ? "Enviando..." : "Tentar enviar agora"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default OfflineQueueIndicator;
