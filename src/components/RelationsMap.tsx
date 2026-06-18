import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  FileText,
  Send,
  ShieldCheck,
  Ban,
  AlertTriangle,
  Cable,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_LABELS } from "@/hooks/useExpenses";

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

interface RuleLevelRow {
  level_order: number;
  approver_name: string;
  approver_email: string | null;
}

export interface RelationsMapExpense {
  id: string;
  status: string;
  current_approver?: string | null;
  approval_rule_id?: string | null;
  requester_name?: string | null;
  sap_doc_num?: number | null;
  total_amount?: number;
  currency?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  expense: RelationsMapExpense | null;
  title?: string;
}

const ORDER: string[] = [
  "rascunho",
  "pendente_aprovacao",
  "aprovado",
  "pc_lancado",
  "nf_entrada",
  "pagamento",
  "finalizado",
];

const DECISION_META: Record<LogDecision, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  created: { label: "Criado", icon: FileText, color: "text-muted-foreground" },
  submitted: { label: "Enviado para aprovação", icon: Send, color: "text-primary" },
  approved: { label: "Aprovado", icon: CheckCircle2, color: "text-success" },
  rejected: { label: "Rejeitado", icon: XCircle, color: "text-destructive" },
  cancelled: { label: "Cancelado", icon: Ban, color: "text-muted-foreground" },
  integrated: { label: "Integrado ao ERP", icon: Cable, color: "text-success" },
  integration_failed: { label: "Falha na integração", icon: AlertTriangle, color: "text-destructive" },
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function RelationsMap({ open, onClose, expense, title }: Props) {
  const [log, setLog] = useState<ApprovalLogRow[]>([]);
  const [levels, setLevels] = useState<RuleLevelRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open || !expense) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const [logRes, levelsRes] = await Promise.all([
        supabase
          .from("expense_approval_log")
          .select("*")
          .eq("expense_id", expense.id)
          .order("decided_at", { ascending: true }),
        expense.approval_rule_id
          ? supabase
              .from("approval_rule_levels")
              .select("level_order, approver_name, approver_email")
              .eq("rule_id", expense.approval_rule_id)
              .order("level_order", { ascending: true })
          : Promise.resolve({ data: [] as RuleLevelRow[] }),
      ]);
      if (cancelled) return;
      setLog(((logRes as any).data || []) as ApprovalLogRow[]);
      setLevels(((levelsRes as any).data || []) as RuleLevelRow[]);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, expense]);

  const statusFlow = useMemo(() => {
    if (!expense) return [];
    const currentIdx = ORDER.indexOf(expense.status);
    const isTerminalBad = expense.status === "rejeitado" || expense.status === "cancelado";
    return ORDER.map((s, i) => ({
      key: s,
      label: STATUS_LABELS[s as keyof typeof STATUS_LABELS] || s,
      state: isTerminalBad
        ? (s === "rascunho" ? "done" : "skipped")
        : i < currentIdx
          ? "done"
          : i === currentIdx
            ? "current"
            : "pending",
    }));
  }, [expense]);

  if (!expense) return null;

  // Próximos aprovadores (níveis ainda não decididos)
  const approvedNames = new Set(
    log
      .filter((l) => l.decision === "approved" && l.approver_name)
      .map((l) => (l.approver_name as string).toLowerCase()),
  );
  const pendingLevels = levels.filter(
    (lv) => !approvedNames.has(lv.approver_name.toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title || "Mapa de Relações"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          {/* Status atual + próximos */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Status
            </h3>
            <div className="flex items-center flex-wrap gap-1.5">
              {statusFlow.map((s, i) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <Badge
                    variant={
                      s.state === "current" ? "default" : s.state === "done" ? "secondary" : "outline"
                    }
                    className={
                      s.state === "skipped"
                        ? "opacity-40 line-through"
                        : s.state === "current"
                          ? "ring-2 ring-primary/40"
                          : ""
                    }
                  >
                    {s.label}
                  </Badge>
                  {i < statusFlow.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Trilha de aprovações prevista */}
          {levels.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Aprovadores previstos
              </h3>
              <div className="space-y-2">
                {levels.map((lv) => {
                  const done = approvedNames.has(lv.approver_name.toLowerCase());
                  const isCurrent =
                    !done &&
                    expense.current_approver &&
                    expense.current_approver.toLowerCase() === lv.approver_name.toLowerCase();
                  return (
                    <div
                      key={`${lv.level_order}-${lv.approver_name}`}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border ${
                        isCurrent ? "border-primary/40 bg-primary/5" : "border-border"
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-muted text-xs font-medium flex items-center justify-center shrink-0">
                        {lv.level_order}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground">{lv.approver_name}</div>
                        {lv.approver_email && (
                          <div className="text-xs text-muted-foreground">{lv.approver_email}</div>
                        )}
                      </div>
                      {done ? (
                        <Badge variant="secondary" className="gap-1 text-success">
                          <ShieldCheck className="w-3 h-3" /> Aprovado
                        </Badge>
                      ) : isCurrent ? (
                        <Badge className="gap-1">
                          <Clock className="w-3 h-3" /> Aguardando
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <Clock className="w-3 h-3" /> Próximo
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
              {pendingLevels.length === 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Todos os níveis previstos foram aprovados.
                </p>
              )}
            </section>
          )}

          {/* Trilha histórica (eventos) */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Trilha de aprovações
            </h3>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : log.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>
            ) : (
              <ol className="space-y-3 relative border-l border-border ml-2 pl-4">
                {log.map((row) => {
                  const meta = DECISION_META[row.decision];
                  const Icon = meta.icon;
                  return (
                    <li key={row.id} className="relative">
                      <span className="absolute -left-[22px] top-0.5 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center">
                        <Icon className={`w-3 h-3 ${meta.color}`} />
                      </span>
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-sm font-medium text-foreground">{meta.label}</div>
                        <div className="text-xs text-muted-foreground font-mono shrink-0">
                          {formatDateTime(row.decided_at)}
                        </div>
                      </div>
                      {row.approver_name && (
                        <div className="text-xs text-muted-foreground">
                          {row.approver_name}
                          {row.approver_email ? ` · ${row.approver_email}` : ""}
                          {row.level_order ? ` · nível ${row.level_order}` : ""}
                        </div>
                      )}
                      {row.remarks && (
                        <div className="text-xs text-foreground bg-muted/40 rounded p-2 mt-1.5">
                          {row.remarks}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
