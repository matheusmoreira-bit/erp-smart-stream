import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { expenseRead } from "@/lib/expense-read";
import { ExpenseEventHistory, type ExpenseEventHistoryExpense } from "@/components/ExpenseEventHistory";

interface Props {
  expenseId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COLUMNS =
  "id, status, doc_type, supplier_name, requester_name, requester_email, current_approver, " +
  "sap_doc_entry, sap_doc_num, sap_integration_error, sap_integration_last_attempt_at, " +
  "company_db, supplier_code, currency, total_amount, created_at, updated_at";

/**
 * Central de avisos → histórico dos marcos do documento referenciado pela
 * notificação (criação, envio, alçadas, integração ERP, NF, pagamento).
 */
export function DocumentMilestonesDialog({ expenseId, open, onOpenChange }: Props) {
  const [expense, setExpense] = useState<(ExpenseEventHistoryExpense & Record<string, unknown>) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!open || !expenseId) {
      setExpense(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error } = await expenseRead("expenses").select(COLUMNS).eq("id", expenseId).limit(1);
      if (!alive) return;
      if (error) setError(error.message);
      else if (!data || data.length === 0) setError("Documento não encontrado ou sem permissão de leitura.");
      else setExpense(data[0]);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [open, expenseId]);

  const title = expense
    ? `${(expense.doc_type as string) === "sales" ? "Pedido de venda" : "Pedido de compra"}${
        expense.sap_doc_num ? ` · SAP ${expense.sap_doc_num}` : ""
      }`
    : "Marcos do documento";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>
            {expense
              ? [expense.supplier_name as string, expense.company_db as string].filter(Boolean).join(" · ") ||
                "Histórico completo do documento"
              : "Histórico completo do documento"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && error && <p className="py-6 text-sm text-destructive text-center">{error}</p>}
        {!loading && !error && expense && (
          <>
            <ExpenseEventHistory expense={expense} />
            <section className="mt-4">
              <h3 className="text-sm font-semibold mb-2">Notificações enviadas</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Quem foi notificado e por qual regra essa pessoa foi resolvida como aprovador atual.
              </p>
              <NotificationAuditTrail expenseId={expense.id as string} />
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
