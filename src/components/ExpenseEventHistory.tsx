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
  Receipt,
  Wallet,
  Loader2,
  Clock,
  XOctagon,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  useNfEntradaLinks,
  useContasPagarLinks,
} from "@/hooks/useRelationsMapDerived";
import { useSapDocApprovalHistory } from "@/components/SapDocApprovalHistory";
import { Button } from "@/components/ui/button";


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
  action_role?: string | null;
  substituted_for_name?: string | null;
  substituted_for_email?: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  approver: "Aprovador",
  substitute: "Substituto",
  delegation: "Delegação",
  admin_override: "Override admin",
  attempt_denied: "Tentativa negada",
};

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
    return new Date(iso).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return iso;
  }
}

function formatCurrency(value?: number | null, currency?: string | null) {
  if (value === undefined || value === null) return "—";
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
}

interface TimelineItem {
  key: string;
  when: string; // ISO
  label: string;
  detail?: string;
  actor?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  reconstructed?: boolean;
}

export interface ExpenseEventHistoryExpense {
  id: string;
  status?: string | null;
  requester_name?: string | null;
  requester_email?: string | null;
  current_approver?: string | null;
  sap_doc_entry?: number | null;
  sap_doc_num?: number | null;
  sap_integration_error?: string | null;
  sap_integration_last_attempt_at?: string | null;
  company_db?: string | null;
  supplier_code?: string | null;
  currency?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface Props {
  expense: ExpenseEventHistoryExpense | null | undefined;
  /** Reload marker — muda quando o pedido é editado/aprovado etc. */
  refreshKey?: string | number;
}

export function ExpenseEventHistory({ expense, refreshKey }: Props) {
  const expenseId = expense?.id;
  const [log, setLog] = useState<ApprovalLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const derivedInput = {
    expenseId: expense?.id || "",
    sapDocEntry: expense?.sap_doc_entry ?? null,
    sapDocNum: expense?.sap_doc_num ?? null,
    companyDb: expense?.company_db ?? null,
    supplierCode: expense?.supplier_code ?? null,
    enabled: !!expense,
  };
  const nfLinks = useNfEntradaLinks(derivedInput);
  const apLinks = useContasPagarLinks(derivedInput);

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
        .select("id,decision,approver_name,approver_email,level_order,remarks,decided_at,action_role,substituted_for_name,substituted_for_email")
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

  // Merge approval events + NF + AP into a single chronological timeline
  const items: TimelineItem[] = [];
  const seenDecisions = new Set<LogDecision>();

  for (const row of log) {
    seenDecisions.add(row.decision);
    const meta = DECISION_META[row.decision] ?? {
      label: row.decision,
      icon: FileText,
      color: "text-muted-foreground",
    };
    const roleLabel = row.action_role ? ROLE_LABEL[row.action_role] || row.action_role : null;
    const onBehalf = row.substituted_for_name || row.substituted_for_email;
    const roleSuffix = roleLabel
      ? ` [${roleLabel}${onBehalf ? ` — em nome de ${onBehalf}` : ""}]`
      : "";
    const actor = row.approver_name
      ? `${row.approver_name}${row.approver_email ? ` · ${row.approver_email}` : ""}${row.level_order ? ` · nível ${row.level_order}` : ""}${roleSuffix}`
      : roleSuffix
        ? roleSuffix.replace(/^ /, "")
        : undefined;
    items.push({
      key: `log:${row.id}`,
      when: row.decided_at,
      label: roleLabel ? `${meta.label} (${roleLabel})` : meta.label,
      detail: row.remarks || undefined,
      actor,
      icon: meta.icon,
      color: meta.color,
    });
  }

  // ── Fallback / reconstructed events ─────────────────────────────────
  // Pedidos antigos foram criados antes do sistema de log existir, então
  // reconstruímos os principais marcos a partir dos campos da despesa.
  const status = (expense?.status || "").toLowerCase();
  const createdAt = expense?.created_at;
  const updatedAt = expense?.updated_at;
  const requester = expense?.requester_name || expense?.requester_email || undefined;

  const addFallback = (
    decision: LogDecision,
    when: string | null | undefined,
    actor?: string,
    detail?: string,
  ) => {
    if (!when) return;
    if (seenDecisions.has(decision)) return;
    const meta = DECISION_META[decision];
    items.push({
      key: `fallback:${decision}`,
      when,
      label: meta.label,
      detail,
      actor,
      icon: meta.icon,
      color: meta.color,
      reconstructed: true,
    });
    seenDecisions.add(decision);
  };

  addFallback("created", createdAt, requester);

  const terminalByStatus: Record<string, LogDecision | undefined> = {
    aprovado: "approved",
    integrado: "approved",
    rejeitado: "rejected",
    cancelado: "cancelled",
  };
  const terminal = terminalByStatus[status];
  if (terminal) {
    addFallback(
      terminal,
      updatedAt,
      terminal === "approved" ? expense?.current_approver || undefined : undefined,
    );
  }

  if (expense?.sap_doc_num || expense?.sap_doc_entry) {
    addFallback(
      "integrated",
      expense?.sap_integration_last_attempt_at || updatedAt,
      undefined,
      expense?.sap_doc_num ? `Nº SAP ${expense.sap_doc_num}` : undefined,
    );
  }
  if (expense?.sap_integration_error) {
    addFallback(
      "integration_failed",
      expense?.sap_integration_last_attempt_at || updatedAt,
      undefined,
      expense.sap_integration_error,
    );
  }


  for (const nf of nfLinks.data || []) {
    const number = `NF ${nf.numero_nf || "—"}${nf.serie ? `/${nf.serie}` : ""}`;
    items.push({
      key: `nf-created:${nf.id}`,
      when: nf.created_at,
      label: `${number} vinculada`,
      detail: [
        nf.nome_fornecedor,
        nf.valor_total != null ? formatCurrency(nf.valor_total, expense?.currency) : null,
        nf.chave_acesso ? `Chave ${nf.chave_acesso}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: Receipt,
      color: "text-primary",
    });
    // Se a NF já foi baixada/completada (updated_at difere e status terminal), adiciona evento de baixa
    const doneStatuses = new Set([
      "completed",
      "cancelled",
      "erpflow_rejected",
      "sap_rejected",
      "integration_error",
    ]);
    if (nf.updated_at && nf.updated_at !== nf.created_at && doneStatuses.has(nf.status)) {
      items.push({
        key: `nf-done:${nf.id}`,
        when: nf.updated_at,
        label: `${number} — ${nf.status}`,
        icon: nf.status === "completed" ? CheckCircle2 : AlertTriangle,
        color: nf.status === "completed" ? "text-success" : "text-destructive",
      });
    }
  }

  for (const ap of apLinks.data?.payables || []) {
    const label = `Título ${ap.numero_documento || "—"} (${ap.source.toUpperCase()})`;
    if (ap.data_registro) {
      items.push({
        key: `ap-created:${ap.id}`,
        when: ap.data_registro,
        label: `${label} lançado em contas a pagar`,
        detail: [
          ap.fornecedor,
          ap.valor_documento != null ? formatCurrency(ap.valor_documento, expense?.currency) : null,
          ap.data_vencimento ? `Venc. ${formatDateTime(ap.data_vencimento).split(" ")[0]}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        icon: Wallet,
        color: "text-primary",
      });
    }
    if (ap.data_pagamento) {
      items.push({
        key: `ap-paid:${ap.id}`,
        when: ap.data_pagamento,
        label: `${label} pago`,
        detail:
          ap.valor_pago != null
            ? `Valor pago ${formatCurrency(ap.valor_pago, expense?.currency)}`
            : undefined,
        icon: CheckCircle2,
        color: "text-success",
      });
    } else if (ap.status && ap.status.toLowerCase().includes("pag")) {
      // Fallback quando SAP indica pago mas não temos data (evita perder o evento)
      items.push({
        key: `ap-paid-nodate:${ap.id}`,
        when: ap.data_vencimento || ap.data_registro || new Date().toISOString(),
        label: `${label} marcado como pago`,
        detail:
          ap.valor_pago != null
            ? `Valor pago ${formatCurrency(ap.valor_pago, expense?.currency)} (data exata indisponível)`
            : "Data exata do pagamento indisponível",
        icon: CheckCircle2,
        color: "text-success",
      });
    }
  }

  items.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());

  const busy = isLoading || nfLinks.isLoading || apLinks.isLoading;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Histórico de eventos
          </span>
        </div>
        {busy && items.length > 0 && (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        )}
      </div>

      {busy && items.length === 0 ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Carregando…
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum evento registrado ainda.</p>
      ) : (
        <ol className="space-y-3 relative border-l border-border ml-2 pl-4">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <li key={it.key} className="relative">
                <span className="absolute -left-[22px] top-0.5 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center">
                  <Icon className={`w-3 h-3 ${it.color}`} />
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-medium flex items-center gap-1.5">
                    {it.label}
                    {it.reconstructed && (
                      <span
                        title="Evento reconstruído a partir dos dados do pedido (anterior ao log detalhado)"
                        className="text-[9px] font-normal uppercase tracking-wider text-muted-foreground border border-border rounded px-1 py-0.5"
                      >
                        reconstruído
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono shrink-0">
                    {formatDateTime(it.when)}
                  </div>
                </div>
                {it.actor && (
                  <div className="text-[11px] text-muted-foreground">{it.actor}</div>
                )}
                {it.detail && (
                  <div className="text-[11px] bg-muted/40 rounded p-2 mt-1.5 break-words">{it.detail}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
