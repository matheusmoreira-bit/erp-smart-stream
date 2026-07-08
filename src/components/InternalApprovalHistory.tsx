import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle2,
  XCircle,
  UserCog,
  Clock,
  Loader2,
  History,
  FileText,
  RotateCcw,
  Pencil,
  Send,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface HistoryEvent {
  id: string;
  at: string;
  kind: "delegate" | "approve" | "reject" | "created" | "updated" | "cancelled" | "reverted" | "transfer" | "other";
  actorLabel: string;
  actorEmail?: string;
  title: string;
  detail?: string;
  reason?: string;
  source: "audit_log" | "expense_approval_log";
}

interface Props {
  expenseId: string;
}

/**
 * Detailed timeline for INTERNAL approval documents. Merges:
 * - All `audit_log` rows for entity_type=expense (delegations, cancellations,
 *   reverts, updates, transfers, SAP document creation, etc.).
 * - Decisions (approve / reject) from `expense_approval_log`.
 * Every event shows timestamp + responsible user.
 */
export function InternalApprovalHistory({ expenseId }: Props) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!expenseId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [auditRes, decRes] = await Promise.all([
        supabase
          .from("audit_log")
          .select("id, action, actor_email, details, created_at")
          .eq("entity_type", "expense")
          .eq("entity_id", expenseId)
          .order("created_at", { ascending: true }),
        supabase
          .from("expense_approval_log")
          .select(
            "id, level_order, approver_name, approver_email, decision, remarks, decided_at, created_at, substituted_for_email, substituted_for_name, action_role",
          )
          .eq("expense_id", expenseId)
          .order("created_at", { ascending: true }),
      ]);

      if (cancelled) return;

      const list: HistoryEvent[] = [];

      for (const r of auditRes.data || []) {
        const d = (r.details || {}) as Record<string, unknown>;
        const action = r.action || "";
        const actor = (d.delegatedBy as string) || r.actor_email || "—";

        if (action === "delegate_approval") {
          const from = (d.previousApprover as string) || "";
          const to = (d.newApproverName as string) || (d.newApproverEmail as string) || "";
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "delegate",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: `Delegou aprovação${from ? ` de ${from}` : ""}${to ? ` para ${to}` : ""}`,
            reason: (d.reason as string) || undefined,
            source: "audit_log",
          });
        } else if (action === "transfer_approval") {
          const from = (d.fromApprover as string) || (d.previousApprover as string) || "";
          const to = (d.toApprover as string) || (d.newApproverName as string) || "";
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "transfer",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: `Transferiu aprovação${from ? ` de ${from}` : ""}${to ? ` para ${to}` : ""}`,
            reason: (d.reason as string) || undefined,
            source: "audit_log",
          });
        } else if (action === "sap_document_created") {
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "created",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: `Documento criado no SAP${d.sap_doc_num ? ` (Nº ${d.sap_doc_num})` : ""}`,
            source: "audit_log",
          });
        } else if (action === "expense_cancelled_manual_sap") {
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "cancelled",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: "Despesa cancelada manualmente (SAP)",
            reason: (d.reason as string) || undefined,
            source: "audit_log",
          });
        } else if (action === "expense_reverted_audit") {
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "reverted",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: "Decisão revertida por auditoria",
            reason: (d.reason as string) || undefined,
            source: "audit_log",
          });
        } else if (action === "update_expense") {
          const fields = Array.isArray(d.changedFields) ? (d.changedFields as string[]).join(", ") : "";
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "updated",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: `Despesa atualizada${fields ? ` (${fields})` : ""}`,
            source: "audit_log",
          });
        } else {
          list.push({
            id: `au-${r.id}`,
            at: r.created_at,
            kind: "other",
            actorLabel: actor,
            actorEmail: r.actor_email || undefined,
            title: action.replace(/_/g, " "),
            source: "audit_log",
          });
        }
      }


      for (const r of decRes.data || []) {
        const isApprove = r.decision === "approve" || r.decision === "aprovado";
        const isReject = r.decision === "reject" || r.decision === "rejeitado";
        const kind: HistoryEvent["kind"] = isApprove ? "approve" : isReject ? "reject" : "other";
        const title =
          kind === "approve"
            ? `Aprovou (nível ${r.level_order ?? "—"})`
            : kind === "reject"
              ? `Rejeitou (nível ${r.level_order ?? "—"})`
              : `Ação: ${r.decision ?? "—"}`;
        const substLabel =
          r.substituted_for_name || r.substituted_for_email
            ? ` em nome de ${r.substituted_for_name || r.substituted_for_email}`
            : "";
        list.push({
          id: `dec-${r.id}`,
          at: r.decided_at || r.created_at,
          kind,
          actorLabel: r.approver_name || r.approver_email || "—",
          actorEmail: r.approver_email || undefined,
          title: title + substLabel,
          reason: r.remarks || undefined,
          source: "expense_approval_log",
        });
      }

      list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      setEvents(list);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [expenseId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Carregando histórico...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        Nenhuma decisão ou delegação registrada ainda.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <History className="w-3.5 h-3.5 text-primary" />
        Histórico
      </div>
      <ol className="relative border-l border-border/60 pl-4 space-y-3">
        {events.map((ev) => {
          const iconMap: Record<HistoryEvent["kind"], typeof CheckCircle2> = {
            approve: CheckCircle2,
            reject: XCircle,
            delegate: UserCog,
            transfer: Send,
            created: FileText,
            updated: Pencil,
            cancelled: XCircle,
            reverted: RotateCcw,
            other: Clock,
          };
          const colorMap: Record<HistoryEvent["kind"], string> = {
            approve: "text-emerald-500",
            reject: "text-destructive",
            delegate: "text-primary",
            transfer: "text-primary",
            created: "text-emerald-500",
            updated: "text-amber-500",
            cancelled: "text-destructive",
            reverted: "text-amber-500",
            other: "text-muted-foreground",
          };
          const Icon = iconMap[ev.kind];
          const iconColor = colorMap[ev.kind];
          return (
            <li key={ev.id} className="relative">
              <span
                className={`absolute -left-[22px] top-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-background border border-border ${iconColor}`}
              >
                <Icon className="w-3 h-3" />
              </span>
              <div className="text-xs">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-foreground font-medium">{ev.title}</span>
                  <span className="text-muted-foreground">
                    {format(new Date(ev.at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  por{" "}
                  <span className="text-foreground">{ev.actorLabel}</span>
                  {ev.actorEmail && ev.actorEmail !== ev.actorLabel && (
                    <span className="text-muted-foreground/80"> · {ev.actorEmail}</span>
                  )}
                </div>
                {ev.reason && (
                  <div className="mt-1 rounded-md bg-muted/40 border border-border/40 px-2 py-1 text-[11px] text-muted-foreground">
                    “{ev.reason}”
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
