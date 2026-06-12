import { AlertTriangle, Badge as BadgeIcon } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Severity = Database["public"]["Enums"]["audit_console_severity"];
type RunStatus = Database["public"]["Enums"]["audit_console_run_status"];

const sevMap: Record<Severity, { label: string; cls: string }> = {
  critical: { label: "Crítica", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  high: { label: "Alta", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  medium: { label: "Média", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" },
  low: { label: "Baixa", cls: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  info: { label: "Info", cls: "bg-muted text-muted-foreground border-border" },
};

const statusMap: Record<RunStatus, { label: string; cls: string }> = {
  pending: { label: "Em execução", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  completed: { label: "Concluída", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  failed: { label: "Falhou", cls: "bg-destructive/15 text-destructive border-destructive/30" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = sevMap[severity] ?? sevMap.info;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <AlertTriangle className="h-3 w-3" />
      {s.label}
    </span>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = statusMap[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <BadgeIcon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

export const DIVERGENCE_TYPE_LABELS: Record<string, string> = {
  missing_order: "Sem pedido",
  value_mismatch: "Valor divergente",
  quantity_mismatch: "Quantidade divergente",
  duplicate_invoice: "Nota duplicada",
  unauthorized_supplier: "Fornecedor não autorizado",
  payment_outside_terms: "Pagamento fora do prazo",
  approval_bypass: "Aprovação burlada",
  approval_below_threshold: "Aprovação abaixo do limite",
  tax_mismatch: "Imposto divergente",
  cost_center_mismatch: "Centro de custo divergente",
  duplicate_payment: "Pagamento duplicado",
  document_missing: "Documento ausente",
  out_of_period: "Fora do período",
  account_mismatch: "Conta divergente",
  other: "Outro",
};
