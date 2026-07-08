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
  kind: "delegate" | "approve" | "reject" | "other";
  actorLabel: string;
  actorEmail?: string;
  title: string;
  detail?: string;
  reason?: string;
}

interface Props {
  expenseId: string;
}

/**
 * Detailed timeline for INTERNAL approval documents:
 * - Delegations (from audit_log where action=delegate_approval)
 * - Decisions (approve / reject) from expense_approval_log
 * Sorted chronologically ascending.
 */
export function InternalApprovalHistory({ expenseId }: Props) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!expenseId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [delegRes, decRes] = await Promise.all([
        supabase
          .from("audit_log")
          .select("id, action, actor_email, details, created_at")
          .eq("entity_type", "expense")
          .eq("entity_id", expenseId)
          .in("action", ["delegate_approval"])
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

      for (const r of delegRes.data || []) {
        const d = (r.details || {}) as Record<string, unknown>;
        const from = (d.previousApprover as string) || "";
        const to = (d.newApproverName as string) || (d.newApproverEmail as string) || "";
        const reason = (d.reason as string) || "";
        list.push({
          id: `del-${r.id}`,
          at: r.created_at,
          kind: "delegate",
          actorLabel: (d.delegatedBy as string) || r.actor_email || "—",
          actorEmail: r.actor_email || undefined,
          title: `Delegou aprovação${from ? ` de ${from}` : ""}${to ? ` para ${to}` : ""}`,
          reason: reason || undefined,
        });
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
          const Icon =
            ev.kind === "approve"
              ? CheckCircle2
              : ev.kind === "reject"
                ? XCircle
                : ev.kind === "delegate"
                  ? UserCog
                  : Clock;
          const iconColor =
            ev.kind === "approve"
              ? "text-emerald-500"
              : ev.kind === "reject"
                ? "text-destructive"
                : ev.kind === "delegate"
                  ? "text-primary"
                  : "text-muted-foreground";
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
