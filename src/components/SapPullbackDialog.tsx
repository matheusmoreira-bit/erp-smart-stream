import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { invokeFn } from "@/lib/invoke-fn";
import { toast } from "sonner";

interface HeaderChange {
  field: string;
  from: unknown;
  to: unknown;
}

interface PullbackItem {
  item_code: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  cost_center: string | null;
  project: string | null;
}

interface PullbackResult {
  success?: boolean;
  applied?: boolean;
  has_changes?: boolean;
  header_changes?: HeaderChange[];
  items_changed?: boolean;
  sap_items?: PullbackItem[];
  local_items?: PullbackItem[];
  sap_doc_num?: number | null;
  error?: string;
}

const FIELD_LABELS: Record<string, string> = {
  supplier_code: "Código do parceiro",
  supplier_name: "Parceiro",
  total_amount: "Valor total",
  currency: "Moeda",
  cost_center: "Centro de custo",
  project: "Projeto",
  remarks: "Observação",
  doc_date: "Data de lançamento",
  due_date: "Vencimento",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(v);
}

function itemLine(i: PullbackItem): string {
  return `${i.item_code ? `${i.item_code} · ` : ""}${i.description} — ${i.quantity} × ${fmt(i.unit_price)} = ${fmt(i.line_total)}${i.cost_center ? ` · CC ${i.cost_center}` : ""}${i.project ? ` · ${i.project}` : ""}`;
}

export function SapPullbackDialog({
  open,
  onOpenChange,
  expenseId,
  erpLabel = "ERP",
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expenseId: string;
  erpLabel?: string;
  onApplied?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<PullbackResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await invokeFn<PullbackResult>("expense-sap-pullback", {
      body: { expense_id: expenseId },
    });
    setLoading(false);
    if (err || data?.error) {
      setError(data?.error || (err as Error)?.message || "Falha ao consultar o ERP");
      return;
    }
    setResult(data);
  }, [expenseId]);

  useEffect(() => {
    if (open) { setResult(null); void load(); }
  }, [open, load]);

  const apply = async () => {
    setApplying(true);
    const { data, error: err } = await invokeFn<PullbackResult>("expense-sap-pullback", {
      body: { expense_id: expenseId, apply: true },
    });
    setApplying(false);
    if (err || data?.error) {
      toast.error(data?.error || (err as Error)?.message || "Falha ao aplicar a atualização");
      return;
    }
    toast.success("Documento atualizado com os dados do ERP. Alteração registrada no histórico.");
    onApplied?.();
    onOpenChange(false);
  };

  // Direção inversa: leva o que está no Flow para o ERP (PATCH do documento).
  const pushToSap = async () => {
    setPushing(true);
    const { data, error: err } = await invokeFn<{ success?: boolean; error?: string; patched?: boolean }>(
      "expense-to-sap",
      { body: { expense_id: expenseId, patch_document: true, use_service_account: true } },
    );
    setPushing(false);
    if (err || data?.error) {
      toast.error(data?.error || (err as Error)?.message || `Falha ao atualizar o documento no ${erpLabel}`);
      return;
    }
    toast.success(`Documento atualizado no ${erpLabel} com os dados do Flow.`);
    onApplied?.();
    void load();
  };

  const changes = result?.header_changes ?? [];
  const hasChanges = !!result?.has_changes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" aria-hidden="true" />
            Sincronizar alterações do {erpLabel}
          </DialogTitle>
          <DialogDescription>
            Compara este documento com a versão atual no {erpLabel} e espelha as diferenças no Flow.
            Use <strong>Aplicar no Flow</strong> para trazer as alterações feitas no {erpLabel}, ou
            <strong> Aplicar no {erpLabel}</strong> para reenviar o documento com os valores atuais do Flow.
            O status e a cadeia de aprovação não são alterados — a mudança fica registrada no histórico.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Consultando o {erpLabel}…
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {!loading && !error && result && !hasChanges && (
          <div className="flex items-center gap-2 rounded border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-primary" aria-hidden="true" />
            Nenhuma diferença: o documento já está idêntico ao {erpLabel}.
          </div>
        )}

        {!loading && !error && hasChanges && (
          <div className="space-y-4">
            {changes.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider">Cabeçalho</div>
                <ul className="divide-y divide-border">
                  {changes.map((c) => (
                    <li key={c.field} className="grid grid-cols-3 gap-2 px-3 py-2 text-xs items-center">
                      <span className="text-muted-foreground">{FIELD_LABELS[c.field] || c.field}</span>
                      <span className="line-through text-muted-foreground break-words">{fmt(c.from)}</span>
                      <span className="text-foreground font-medium break-words">{fmt(c.to)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.items_changed && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                  Itens <Badge variant="outline" className="text-[10px]">alterados</Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 text-xs">
                  <div className="space-y-1">
                    <p className="text-muted-foreground">No Flow (atual)</p>
                    {(result.local_items || []).map((i, idx) => (
                      <p key={`l-${idx}`} className="text-muted-foreground break-words">{itemLine(i)}</p>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">No {erpLabel}</p>
                    {(result.sap_items || []).map((i, idx) => (
                      <p key={`s-${idx}`} className="text-foreground break-words">{itemLine(i)}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || applying}>
            Reconsultar
          </Button>
          <Button size="sm" variant="outline" onClick={() => void apply()} disabled={!hasChanges || loading || applying || pushing}>
            {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" aria-hidden="true" /> : null}
            Aplicar no Flow
          </Button>
          <Button size="sm" onClick={() => void pushToSap()} disabled={loading || applying || pushing}>
            {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" aria-hidden="true" /> : null}
            Aplicar no {erpLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
