import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, FileSearch, Link2Off, Loader2, PenLine, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useMastertaxPoSearch, type ManualNfInput } from "@/hooks/useMastertaxPoSearch";
import { PoMastertaxNfDialog } from "@/components/PoMastertaxNfDialog";
import { PoNfManualDialog } from "@/components/PoNfManualDialog";

const HIGH_CONFIDENCE = 85;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}
function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

interface Props {
  companyDb: string | null | undefined;
  poDocEntry: number | string;
  poLabel: string;
  expenseId?: string | null;
  onDone?: () => void;
}

/**
 * Ação estratégica de NF de entrada no pedido de compra:
 *  - match >= 85%  → lançar direto (usuário confere antes)
 *  - match < 85%   → buscar na Master Tax
 *  - internacional → lançamento manual (com apoio de IA nos anexos)
 */
export function PoNfEntradaActions({ companyDb, poDocEntry, poLabel, expenseId, onDone }: Props) {
  const { search, link, unlink, manualPost, aiExtract, loading, linking, error, result } =
    useMastertaxPoSearch(companyDb);
  const [searchOpen, setSearchOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const refresh = useCallback(async () => { await search(poDocEntry, 90); }, [search, poDocEntry]);

  useEffect(() => { void refresh(); }, [refresh]);

  const best = result?.candidates?.[0];
  const confidence = result?.bestConfidence ?? 0;
  const linked = result?.linked ?? null;
  const international = result?.supplier?.international === true;
  const highMatch = !!best && confidence >= HIGH_CONFIDENCE;
  const nf = linked
    ? {
      numero: linked.numeroNf, serie: linked.serie, valor: linked.valorTotal,
      data: linked.dataEmissao, fornecedor: linked.nomeFornecedor, chave: linked.chaveAcesso,
    }
    : best
      ? {
        numero: best.numero_nf, serie: best.serie, valor: best.valor_total,
        data: best.data_emissao, fornecedor: best.nome_fornecedor, chave: best.chave_acesso,
      }
      : null;

  const afterAction = async () => {
    onDone?.();
    await refresh();
  };

  const doPost = async () => {
    if (!nf?.chave) return;
    try {
      const res = await link(poDocEntry, nf.chave, "post");
      toast.success(
        res.alreadyExists
          ? `NF já estava lançada (#${res.invoiceDocNum || res.invoiceDocEntry}).`
          : `NF de entrada #${res.invoiceDocNum || res.invoiceDocEntry} lançada no ERP.`,
      );
      setConfirmOpen(false);
      await afterAction();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const doUnlink = async () => {
    if (!linked) return;
    try {
      await unlink(poDocEntry, linked.importId, "Vinculação incorreta indicada pelo usuário");
      toast.success("Vinculação desfeita. Você pode buscar ou lançar outra NF.");
      setUnlinkOpen(false);
      setConfirmOpen(false);
      await afterAction();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const doManual = async (data: ManualNfInput, mode: "draft" | "post") => {
    const res = await manualPost(poDocEntry, data, mode);
    toast.success(mode === "post"
      ? `NF de entrada #${res.invoiceDocNum || res.invoiceDocEntry} lançada no ERP.`
      : `Esboço da NF criado no ERP (#${res.draftId}).`);
    setManualOpen(false);
    await afterAction();
  };

  if (loading) {
    return (
      <Button variant="outline" disabled className="w-full sm:w-auto justify-center gap-1.5">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Verificando NF de entrada…
      </Button>
    );
  }

  return (
    <>
      <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:w-auto">
        {linked?.posted ? (
          <Button
            variant="outline"
            className="w-full sm:w-auto justify-center gap-1.5 border-emerald-500/40 text-emerald-600"
            onClick={() => setConfirmOpen(true)}
          >
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            NF de entrada #{linked.invoiceDocNum || linked.invoiceDocEntry} lançada
          </Button>
        ) : linked ? (
          <Button className="w-full sm:w-auto justify-center gap-1.5" onClick={() => setConfirmOpen(true)}>
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            Conferir NF vinculada e lançar
          </Button>
        ) : highMatch ? (
          <Button className="w-full sm:w-auto justify-center gap-1.5" onClick={() => setConfirmOpen(true)}>
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            Lançar NF de entrada ({confidence}%)
          </Button>
        ) : !international ? (
          <Button variant="outline" className="w-full sm:w-auto justify-center gap-1.5" onClick={() => setSearchOpen(true)}>
            <FileSearch className="w-4 h-4" aria-hidden="true" />
            Buscar NF na Master Tax
          </Button>
        ) : null}

        {!linked?.posted && (
          <Button
            variant={international && !highMatch ? "default" : "outline"}
            className="w-full sm:w-auto justify-center gap-1.5"
            onClick={() => setManualOpen(true)}
            title="Digitar os dados da NF (com apoio opcional da IA nos anexos)"
          >
            <PenLine className="w-4 h-4" aria-hidden="true" />
            Lançar manualmente
          </Button>
        )}

        {!linked && highMatch && (
          <Button variant="ghost" className="w-full sm:w-auto justify-center gap-1.5" onClick={() => setSearchOpen(true)}>
            <FileSearch className="w-4 h-4" aria-hidden="true" />
            Ver outras notas
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-destructive w-full">{error}</p>}

      {/* Conferência da NF antes do lançamento */}
      <Dialog open={confirmOpen} onOpenChange={(v) => { if (!v && !linking) setConfirmOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confira a NF antes de lançar</DialogTitle>
            <DialogDescription>
              Estes dados serão lançados no ERP vinculados ao pedido {poLabel}.
            </DialogDescription>
          </DialogHeader>

          {nf ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">NF {nf.numero || "—"}{nf.serie ? `/${nf.serie}` : ""}</span>
                {!linked && (
                  <Badge variant="outline" className="text-[10px]">
                    <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" /> confiança {confidence}%
                  </Badge>
                )}
                {linked?.posted && (
                  <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">
                    já lançada no ERP
                  </Badge>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Fornecedor</dt>
                <dd className="text-right">{nf.fornecedor || result?.purchaseOrder.cardName || "—"}</dd>
                <dt className="text-muted-foreground">Emissão</dt>
                <dd className="text-right">{formatDate(nf.data)}</dd>
                <dt className="text-muted-foreground">Valor da NF</dt>
                <dd className="text-right font-mono">{formatCurrency(nf.valor)}</dd>
                <dt className="text-muted-foreground">Valor do pedido</dt>
                <dd className="text-right font-mono">{formatCurrency(result?.purchaseOrder.docTotal || 0)}</dd>
                {nf.chave && !nf.chave.startsWith("MANUAL-") && (
                  <>
                    <dt className="text-muted-foreground">Chave</dt>
                    <dd className="text-right font-mono text-[10px] break-all">{nf.chave}</dd>
                  </>
                )}
              </dl>
              {Math.abs((nf.valor || 0) - (result?.purchaseOrder.docTotal || 0)) >= 0.01 && (
                <Alert>
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  <AlertDescription className="text-xs">
                    A NF e o pedido têm valores diferentes. Confirme antes de lançar.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma NF vinculada.</p>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={linking}>Fechar</Button>
            {linked && !linked.posted && (
              <Button
                variant="outline"
                className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setUnlinkOpen(true)}
                disabled={linking}
              >
                <Link2Off className="w-4 h-4" aria-hidden="true" />
                Vinculação incorreta
              </Button>
            )}
            {!linked?.posted && nf && (
              <Button onClick={() => void doPost()} disabled={linking}>
                {linking && <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />}
                Lançar NF no ERP
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de desvinculação */}
      <Dialog open={unlinkOpen} onOpenChange={(v) => { if (!v && !linking) setUnlinkOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Desvincular esta NF do pedido?</DialogTitle>
            <DialogDescription>
              A nota volta para a fila de conciliação e o pedido fica livre para receber outra NF.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setUnlinkOpen(false)} disabled={linking}>Voltar</Button>
            <Button variant="destructive" onClick={() => void doUnlink()} disabled={linking}>
              {linking && <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />}
              Desvincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {searchOpen && (
        <PoMastertaxNfDialog
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          companyDb={companyDb}
          poDocEntry={poDocEntry}
          poLabel={poLabel}
          onDone={() => { void afterAction(); }}
        />
      )}

      <PoNfManualDialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        poLabel={poLabel}
        supplierName={result?.purchaseOrder.cardName}
        supplierTaxId={result?.supplier?.taxId}
        poTotal={result?.purchaseOrder.docTotal}
        poDate={result?.purchaseOrder.docDate}
        international={international}
        expenseId={expenseId}
        busy={linking}
        onAiExtract={expenseId ? (async () => {
          const r = await aiExtract(poDocEntry, expenseId);
          return { fields: r.fields, analyzedFiles: r.analyzedFiles };
        }) : undefined}
        onSubmit={doManual}
      />
    </>
  );
}

export default PoNfEntradaActions;
