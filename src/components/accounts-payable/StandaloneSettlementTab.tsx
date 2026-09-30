import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Scale } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SettlementStatus = "pending" | "needs_review" | "error" | "settled";

interface CandidateInvoice {
  doc_entry: number;
  doc_num: number;
  doc_total: number;
}

export interface SettlementItem {
  id: string;
  expense_id: string;
  supplier_code: string;
  supplier_name: string;
  amount: number;
  paid_amount: number | null;
  paid_date: string | null;
  status: string;
  sap_settlement_status: SettlementStatus;
  settlement_note: string | null;
  sap_payment_doc_num: number | null;
  sap_error: string | null;
  sap_po_doc_num: number | null;
  candidate_invoices: CandidateInvoice[] | null;
}

type Caller = <T>(action: string, payload?: Record<string, unknown>) => Promise<T>;

const statusLabel: Record<SettlementStatus, string> = {
  pending: "Aguardando baixa no SAP",
  needs_review: "Precisa de ação",
  error: "Erro",
  settled: "Baixado no SAP",
};

const money = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const date = (value: string | null | undefined) =>
  value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "-";

interface Props {
  call: Caller;
  standalone: boolean;
}

/** Conciliação dos pagamentos feitos em modo standalone com as NFs do SAP. */
export function StandaloneSettlementTab({ call, standalone }: Props) {
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [review, setReview] = useState<SettlementItem | null>(null);
  const [mode, setMode] = useState<"auto" | "partial" | "manual_adjust">("auto");
  const [invoice, setInvoice] = useState<string>("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call<{ items: SettlementItem[] }>("list_settlements");
      setItems(result.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  async function run(payload: Record<string, unknown>) {
    setRunning(true);
    try {
      const result = await call<{ results: Array<{ status: string }>; message?: string }>("settle_pending_in_sap", payload);
      const settled = result.results.filter((r) => r.status === "settled" || r.status === "settled_manual").length;
      const review = result.results.filter((r) => r.status === "needs_review").length;
      toast.success(result.message || `${settled} baixado(s) no SAP · ${review} precisam de ação.`);
      setReview(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const open = items.filter((i) => i.sap_settlement_status !== "settled");

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Pagamentos feitos sem o SAP. Quando o SAP voltar, a baixa é feita contra a NF do pedido, usando a conta transitória.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" aria-label="Atualizar conciliação" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button className="gap-2" disabled={standalone || running || open.length === 0} onClick={() => void run({ mode: "auto" })}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
            Conciliar pendentes
          </Button>
        </div>
      </div>

      {standalone && (
        <Alert>
          <AlertTitle>SAP indisponível</AlertTitle>
          <AlertDescription>A baixa no SAP só fica liberada depois que o modo standalone for desligado.</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar a conciliação</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !items.length ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : !items.length && !error ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhum pagamento feito em modo standalone.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PC</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Pago em</TableHead>
              <TableHead className="text-right">Valor pago</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Detalhe</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-sm">{item.sap_po_doc_num ? `#${item.sap_po_doc_num}` : "sem PC"}</TableCell>
                <TableCell>
                  <p className="font-medium">{item.supplier_name}</p>
                  <p className="text-xs text-muted-foreground">{item.supplier_code}</p>
                </TableCell>
                <TableCell>{date(item.paid_date)}</TableCell>
                <TableCell className="text-right font-semibold">{money(item.paid_amount ?? item.amount)}</TableCell>
                <TableCell>
                  <Badge variant={item.sap_settlement_status === "settled" ? "default" : item.sap_settlement_status === "pending" ? "secondary" : "destructive"}>
                    {statusLabel[item.sap_settlement_status]}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs text-xs text-muted-foreground">
                  {item.settlement_note || item.sap_error || (item.sap_payment_doc_num ? `Pagamento SAP ${item.sap_payment_doc_num}` : "-")}
                </TableCell>
                <TableCell>
                  {item.sap_settlement_status !== "settled" && item.status === "paid" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={standalone}
                      onClick={() => { setReview(item); setMode("auto"); setInvoice(""); setNote(""); }}
                    >
                      Resolver
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!review} onOpenChange={(value) => !value && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolver baixa</DialogTitle>
            <DialogDescription>
              {review?.supplier_name} · pago {money(review?.paid_amount ?? review?.amount)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {review?.settlement_note && <p className="text-sm text-muted-foreground">{review.settlement_note}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="settle-mode">Ação</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger id="settle-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Baixar pelo valor exato</SelectItem>
                  <SelectItem value="partial">Baixa parcial na NF</SelectItem>
                  <SelectItem value="manual_adjust">Ajuste manual (sem lançar no SAP)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode !== "manual_adjust" && !!review?.candidate_invoices?.length && (
              <div className="space-y-1.5">
                <Label htmlFor="settle-invoice">NF de entrada</Label>
                <Select value={invoice} onValueChange={setInvoice}>
                  <SelectTrigger id="settle-invoice"><SelectValue placeholder="Escolha a NF" /></SelectTrigger>
                  <SelectContent>
                    {review.candidate_invoices.map((c) => (
                      <SelectItem key={c.doc_entry} value={String(c.doc_entry)}>NF {c.doc_num} · {money(c.doc_total)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {mode === "manual_adjust" && (
              <div className="space-y-1.5">
                <Label htmlFor="settle-note">Justificativa</Label>
                <Textarea id="settle-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Ex.: baixa lançada manualmente no SAP pela tesouraria, pagamento 1234." />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)}>Cancelar</Button>
            <Button
              disabled={running || (mode === "manual_adjust" && note.trim().length < 10)}
              onClick={() => review && void run({
                item_id: review.id,
                mode,
                note: note.trim() || undefined,
                invoice_doc_entry: invoice ? Number(invoice) : undefined,
              })}
            >
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
