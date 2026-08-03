import { useState } from "react";
import { FilePlus2, RotateCw, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NfEntradaImport } from "@/hooks/useNfEntrada";

/** Limite de linhas processadas por lote — protege a sessão do SAP e o rate limit. */
export const BULK_LIMIT = 25;

export type BulkAction = "reprocess" | "draft";

type RunResult = {
  id: string;
  label: string;
  ok: boolean;
  message: string;
};

export function canCreateInvoiceDraftFor(it: NfEntradaImport) {
  return (
    !!it.sap_matched_po_doc_entry &&
    it.sap_matched_po_is_draft !== true &&
    !it.sap_invoice_draft_id &&
    it.status !== "cancelled" &&
    it.status !== "completed"
  );
}

export function canReprocess(it: NfEntradaImport) {
  return it.status !== "cancelled" && it.status !== "completed";
}

interface Props {
  selected: NfEntradaImport[];
  onClear: () => void;
  reprocess: (id: string) => Promise<unknown>;
  createInvoiceDraft: (id: string) => Promise<{ alreadyExists?: boolean; draftId?: string | number } | null | undefined>;
  onFinished: () => void;
}

/**
 * Barra de ações em lote da tela de NF de Entrada.
 * Processa item a item (sequencial) para não estourar a sessão do SAP,
 * mostrando progresso e um relatório final por linha.
 */
export function NfEntradaBulkActions({ selected, onClear, reprocess, createInvoiceDraft, onFinished }: Props) {
  const [action, setAction] = useState<BulkAction | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<RunResult[]>([]);
  const [cancelRequested, setCancelRequested] = useState(false);

  const eligible = action
    ? selected.filter(action === "draft" ? canCreateInvoiceDraftFor : canReprocess).slice(0, BULK_LIMIT)
    : [];
  const skipped = action ? selected.length - eligible.length : 0;

  const draftCount = selected.filter(canCreateInvoiceDraftFor).length;
  const reprocessCount = selected.filter(canReprocess).length;

  function open(a: BulkAction) {
    setAction(a);
    setResults([]);
    setDone(0);
    setCancelRequested(false);
  }

  function close() {
    if (running) return;
    const hadResults = results.length > 0;
    setAction(null);
    setResults([]);
    setDone(0);
    if (hadResults) onFinished();
  }

  async function run() {
    if (!action || eligible.length === 0) return;
    setRunning(true);
    setResults([]);
    setDone(0);
    const acc: RunResult[] = [];
    for (const it of eligible) {
      if (cancelRequested) break;
      const label = `NF ${it.numero_nf || it.id.slice(0, 8)}${it.nome_fornecedor ? ` · ${it.nome_fornecedor}` : ""}`;
      try {
        if (action === "reprocess") {
          await reprocess(it.id);
          acc.push({ id: it.id, label, ok: true, message: "Integração reenviada" });
        } else {
          const res = await createInvoiceDraft(it.id);
          acc.push({
            id: it.id,
            label,
            ok: true,
            message: res?.alreadyExists
              ? `Esboço já existia (${res.draftId})`
              : `Esboço ${res?.draftId ?? ""} criado`.trim(),
          });
        }
      } catch (e) {
        acc.push({ id: it.id, label, ok: false, message: (e as Error).message });
      }
      setResults([...acc]);
      setDone(acc.length);
    }
    setRunning(false);
  }

  const total = eligible.length;
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  const finished = !running && results.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">{selected.length} selecionada(s)</span>
        <span className="text-xs text-muted-foreground">limite de {BULK_LIMIT} por lote</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={reprocessCount === 0} onClick={() => open("reprocess")}>
            <RotateCw className="w-4 h-4" /> Reenviar integração ({reprocessCount})
          </Button>
          <Button size="sm" variant="outline" disabled={draftCount === 0} onClick={() => open("draft")}>
            <FilePlus2 className="w-4 h-4" /> Lançar esboço de NF ({draftCount})
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear} aria-label="Limpar seleção">
            <X className="w-4 h-4" /> Limpar
          </Button>
        </div>
      </div>

      <Dialog open={action !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {action === "draft" ? "Lançar esboços de NF de entrada no SAP" : "Reenviar integração ao SAP"}
            </DialogTitle>
            <DialogDescription>
              {total} documento(s) serão processados um a um.
              {skipped > 0 && ` ${skipped} selecionado(s) foram ignorados por não estarem elegíveis.`}
            </DialogDescription>
          </DialogHeader>

          {(running || finished) && (
            <div className="space-y-3">
              <Progress value={total ? (done / total) * 100 : 0} />
              <div className="text-xs text-muted-foreground">
                {done} de {total} processados · {okCount} ok · {failCount} com erro
              </div>
              <ScrollArea className="h-52 rounded-md border border-border">
                <ul className="divide-y divide-border text-xs">
                  {results.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 px-3 py-2">
                      {r.ok
                        ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />
                        : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.label}</div>
                        <div className={`break-words ${r.ok ? "text-muted-foreground" : "text-destructive"}`}>{r.message}</div>
                      </div>
                    </li>
                  ))}
                  {running && (
                    <li className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processando…
                    </li>
                  )}
                </ul>
              </ScrollArea>
            </div>
          )}

          <DialogFooter className="gap-2">
            {running ? (
              <Button variant="outline" onClick={() => setCancelRequested(true)} disabled={cancelRequested}>
                {cancelRequested ? "Parando após o item atual…" : "Parar após o item atual"}
              </Button>
            ) : finished ? (
              <Button onClick={close}>Fechar</Button>
            ) : (
              <>
                <Button variant="outline" onClick={close}>Cancelar</Button>
                <Button onClick={run} disabled={total === 0}>Processar {total}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
