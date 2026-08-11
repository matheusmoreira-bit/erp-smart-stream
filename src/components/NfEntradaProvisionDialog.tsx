import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, FileCheck2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useNfEntradaQueue, type NfEntradaPreview } from "@/hooks/useNfEntradaQueue";
import type { NfEntradaImport } from "@/hooks/useNfEntrada";

function brl(v: number | null | undefined) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface Props {
  item: NfEntradaImport | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * Conferência humana antes de provisionar o esboço da NF de Entrada no ERP.
 *
 * Mostra o de-para nota capturada x pedido de compra, destaca divergências
 * e exige justificativa quando a diferença ultrapassa a tolerância. A escrita
 * em si é assíncrona: aqui só registramos a intenção na fila.
 */
export function NfEntradaProvisionDialog({ item, onOpenChange, onDone }: Props) {
  const { toast } = useToast();
  const { preview, enqueue, processQueue } = useNfEntradaQueue();
  const [data, setData] = useState<NfEntradaPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!item) { setData(null); setLoadError(null); setReason(""); return; }
    setLoading(true);
    setLoadError(null);
    preview(item.id)
      .then(setData)
      .catch((e) => setLoadError((e as Error).message))
      .finally(() => setLoading(false));
  }, [item, preview]);

  const div = data?.divergencia;
  const blocked = !!div?.bloqueante && !reason.trim();

  async function handleConfirm() {
    if (!item || !data) return;
    setSubmitting(true);
    try {
      const results = await enqueue({
        importIds: [item.id],
        operation: "invoice_draft",
        payload: {
          valor_pedido: data.pedido.valor_total,
          data_documento: data.nota.data_emissao,
          comentario: `NF ${data.nota.numero ?? data.nota.chave}`,
          linhas: data.pedido.linhas.map((l) => ({
            line_num: l.line_num,
            quantidade: l.quantidade,
            valor_total: l.valor_total,
          })),
        },
        overrideReason: reason.trim() || undefined,
      });
      const r = results[0];
      if (!r?.queued) {
        toast({ title: "Nada foi enfileirado", description: r?.reason || "Sem alterações.", variant: "destructive" });
        return;
      }
      toast({ title: "Solicitação registrada", description: "Enviando ao ERP…" });
      const processed = await processQueue(r.queue_id);
      const p = processed[0];
      if (p?.status === "synced") {
        toast({ title: "Esboço provisionado no ERP", description: `Documento ${p.document_id}` });
      } else if (p?.error) {
        toast({ title: "O ERP recusou o lançamento", description: p.error, variant: "destructive" });
      } else {
        toast({ title: "Na fila", description: "O lançamento será aplicado na próxima execução." });
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Falha ao provisionar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4" /> Conferir e provisionar NF de Entrada
          </DialogTitle>
          <DialogDescription>
            Confira o de-para entre a nota capturada e o pedido de compra antes de gravar o esboço no ERP.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {!loading && loadError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Não foi possível montar a conferência</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {!loading && data && (
          <div className="space-y-4">
            {data.ja_lancada && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>NF já lançada no ERP</AlertTitle>
                <AlertDescription>
                  O pedido já possui a NF de Entrada {data.ja_lancada.numero ?? data.ja_lancada.id}. Não é necessário provisionar.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-md border p-3">
                <div className="text-xs uppercase text-muted-foreground mb-1">Nota capturada</div>
                <div className="font-medium">{data.nota.fornecedor || "—"}</div>
                <div className="text-muted-foreground">NF {data.nota.numero || "—"} · {data.nota.cnpj || "—"}</div>
                <div className="mt-1 font-mono">{brl(data.nota.valor_total)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs uppercase text-muted-foreground mb-1">Pedido de compra ({data.erp_type})</div>
                <div className="font-medium">{data.pedido.fornecedor_nome || data.pedido.fornecedor_id || "—"}</div>
                <div className="text-muted-foreground">Documento {data.pedido.numero ?? data.pedido.id}</div>
                <div className="mt-1 font-mono">{brl(data.pedido.valor_total)}</div>
              </div>
            </div>

            {div && (div.bloqueante || div.linhas_diferentes || div.diferenca > 0) && (
              <Alert variant={div.bloqueante ? "destructive" : "default"}>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {div.bloqueante ? "Divergência acima da tolerância" : "Divergência dentro da tolerância"}
                </AlertTitle>
                <AlertDescription className="space-y-1">
                  <div>
                    Diferença de {brl(div.diferenca)} ({div.percentual}%) entre nota e pedido.
                    {div.linhas_diferentes && " A quantidade de linhas da nota difere da do pedido."}
                  </div>
                  {div.bloqueante && (
                    <div className="pt-1">
                      Para prosseguir, justifique a liberação — o motivo fica registrado no histórico.
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Linhas do pedido a faturar</div>
              <ScrollArea className="max-h-56 rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>CC / Projeto</TableHead>
                      <TableHead className="text-right">Qtde</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pedido.linhas.map((l) => (
                      <TableRow key={l.line_num}>
                        <TableCell className="font-mono">{l.line_num}</TableCell>
                        <TableCell>
                          <div className="font-medium">{l.item_code || "—"}</div>
                          <div className="text-xs text-muted-foreground">{l.descricao || "—"}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {[l.centro_custo, l.projeto].filter(Boolean).join(" · ") || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">{l.quantidade ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono">{brl(l.valor_total)}</TableCell>
                      </TableRow>
                    ))}
                    {data.pedido.linhas.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          O pedido não retornou linhas.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>

            {div?.bloqueante && (
              <div className="space-y-1">
                <label htmlFor="override-reason" className="text-sm font-medium">
                  Justificativa da liberação
                </label>
                <Textarea
                  id="override-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex.: diferença de frete acordada com o fornecedor, aprovada pelo fiscal."
                  rows={3}
                />
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              O documento é criado como pré-lançamento (esboço): o time fiscal finaliza impostos e conferência no ERP.
              {data.divergencia.override_aplicado && (
                <Badge variant="outline" className="ml-2">Liberação anterior registrada</Badge>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!data || loading || submitting || blocked || !!data?.ja_lancada}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Provisionar esboço
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
