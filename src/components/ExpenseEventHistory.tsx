import { useEffect, useState } from "react";
import {
  FileText,
  Send,
  CheckCircle2,
  XCircle,
  Ban,
  Cable,
  AlertTriangle,
  History,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type LogDecision =
  | "created"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "integrated"
  | "integration_failed";

interface ApprovalLogRow {
  id: string;
  decision: LogDecision;
  approver_name: string | null;
  approver_email: string | null;
  level_order: number | null;
  remarks: string | null;
  decided_at: string;
}

const DECISION_META: Record<LogDecision, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  created: { label: "Criado", icon: FileText, color: "text-muted-foreground" },
  submitted: { label: "Enviado para aprovação", icon: Send, color: "text-primary" },
  approved: { label: "Aprovado", icon: CheckCircle2, color: "text-success" },
  rejected: { label: "Rejeitado", icon: XCircle, color: "text-destructive" },
  cancelled: { label: "Cancelado", icon: Ban, color: "text-muted-foreground" },
  integrated: { label: "Integrado ao ERP", icon: Cable, color: "text-success" },
  integration_failed: { label: "Falha na integração", icon: AlertTriangle, color: "text-destructive" },
};

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

interface Props {
  expenseId: string | null | undefined;
  /** Reload marker — muda quando o pedido é editado/aprovado etc. */
  refreshKey?: string | number;
}

export function ExpenseEventHistory({ expenseId, refreshKey }: Props) {
  const [log, setLog] = useState<ApprovalLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!expenseId) {
      setLog([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from("expense_approval_log")
        .select("id,decision,approver_name,approver_email,level_order,remarks,decided_at")
        .eq("expense_id", expenseId)
        .order("decided_at", { ascending: true });
      if (cancelled) return;
      setLog((data || []) as ApprovalLogRow[]);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [expenseId, refreshKey]);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Histórico de eventos
        </span>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : log.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum evento registrado ainda.</p>
      ) : (
        <ol className="space-y-3 relative border-l border-border ml-2 pl-4">
          {log.map((row) => {
            const meta = DECISION_META[row.decision] ?? {
              label: row.decision,
              icon: FileText,
              color: "text-muted-foreground",
            };
            const Icon = meta.icon;
            return (
              <li key={row.id} className="relative">
                <span className="absolute -left-[22px] top-0.5 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center">
                  <Icon className={`w-3 h-3 ${meta.color}`} />
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-medium">{meta.label}</div>
                  <div className="text-[10px] text-muted-foreground font-mono shrink-0">
                    {formatDateTime(row.decided_at)}
                  </div>
                </div>
                {row.approver_name && (
                  <div className="text-[11px] text-muted-foreground">
                    {row.approver_name}
                    {row.approver_email ? ` · ${row.approver_email}` : ""}
                    {row.level_order ? ` · nível ${row.level_order}` : ""}
                  </div>
                )}
                {row.remarks && (
                  <div className="text-[11px] bg-muted/40 rounded p-2 mt-1.5">{row.remarks}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
