import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2, BellRing, Mail, Smartphone, MessageSquare, Send } from "lucide-react";
import { displayUser } from "@/lib/user-display";

export interface NotificationAuditRow {
  id: string;
  expense_id: string | null;
  company_db: string | null;
  channel: string;
  recipient: string;
  recipient_name: string | null;
  recipient_role: string;
  level_order: number | null;
  event_key: string;
  status: string;
  resolution_source: string | null;
  resolution_reason: string | null;
  rule_id: string | null;
  rule_name: string | null;
  matrix_version: string | null;
  cost_center: string | null;
  project: string | null;
  created_at: string;
}

const CHANNEL_ICON: Record<string, typeof Mail> = {
  email: Mail,
  in_app: BellRing,
  push: Smartphone,
  slack: MessageSquare,
  whatsapp: Send,
};

const SOURCE_LABEL: Record<string, string> = {
  matrix_rule: "Regra da matriz",
  next_level: "Próximo nível da alçada",
  manual_reassign: "Reatribuição manual",
  sla_escalation: "Escalonamento por SLA",
  substitute: "Substituto vigente",
  self_approval_escalation: "Bloqueio de autoaprovação",
  default_fallback: "Aprovador de contingência",
  current_approver: "Aprovador atual",
};

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "sent") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
}

interface Props {
  /** Quando informado, filtra a trilha por documento. */
  expenseId?: string | null;
  limit?: number;
}

/**
 * Trilha de auditoria de notificações: por documento, quem recebeu o aviso,
 * em qual canal e por qual regra/matriz foi resolvido como aprovador atual.
 */
export function NotificationAuditTrail({ expenseId = null, limit = 50 }: Props) {
  const [rows, setRows] = useState<NotificationAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      let q = supabase
        .from("notification_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (expenseId) q = q.eq("expense_id", expenseId);
      const { data, error } = await q;
      if (!alive) return;
      if (error) setError(error.message);
      else setRows((data || []) as unknown as NotificationAuditRow[]);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [expenseId, limit]);

  if (loading) {
    return (
      <div className="py-6 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) return <p className="py-4 text-sm text-destructive">{error}</p>;
  if (rows.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Nenhuma notificação registrada {expenseId ? "para este documento" : "ainda"}.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const Icon = CHANNEL_ICON[r.channel] ?? BellRing;
        return (
          <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">
                {r.recipient_name ? displayUser(r.recipient_name) : displayUser(r.recipient)}
              </span>
              <Badge variant="outline" className="text-[11px]">{r.recipient_role}</Badge>
              <Badge variant={statusVariant(r.status)} className="text-[11px]">{r.status}</Badge>
              {r.level_order != null && (
                <span className="text-xs text-muted-foreground">nível {r.level_order}</span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString("pt-BR")}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {SOURCE_LABEL[r.resolution_source || ""] || r.resolution_source || "Origem não informada"}
              </span>
              {r.resolution_reason ? ` — ${r.resolution_reason}` : ""}
            </p>
            {(r.rule_name || r.cost_center || r.project || r.company_db) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {[
                  r.company_db ? `Empresa: ${r.company_db}` : null,
                  r.rule_name ? `Regra: ${r.rule_name}` : null,
                  r.cost_center ? `CC: ${r.cost_center}` : null,
                  r.project ? `Projeto: ${r.project}` : null,
                  r.matrix_version ? `Matriz: ${r.matrix_version}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
