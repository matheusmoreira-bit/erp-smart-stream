import { cn } from "@/lib/utils";
import { originSegmentClasses } from "@/lib/erp-origin-styles";

/**
 * Chip único que combina status do documento e origem (ERP Flow x ERP nativo).
 * Substitui os dois badges empilhados que quebravam em várias linhas na tabela.
 */
export type DocOrigin = "erp_flow" | "erp" | null | undefined;

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, { shell: string; label: string; origin: string }> = {
  neutral: {
    shell: "border-border bg-muted/40",
    label: "text-muted-foreground",
    origin: "bg-muted-foreground/70 text-background border-border",
  },
  primary: {
    shell: "border-primary/30 bg-primary/10",
    label: "text-primary",
    origin: "bg-primary text-primary-foreground border-primary/30",
  },
  success: {
    shell: "border-success/30 bg-success/10",
    label: "text-success",
    origin: "bg-success text-success-foreground border-success/30",
  },
  warning: {
    shell: "border-warning/35 bg-warning/10",
    label: "text-warning",
    origin: "bg-warning text-warning-foreground border-warning/30",
  },
  danger: {
    shell: "border-destructive/30 bg-destructive/10",
    label: "text-destructive",
    origin: "bg-destructive text-destructive-foreground border-destructive/30",
  },
};

const STATUS_TONES: Record<string, Tone> = {
  rascunho: "neutral",
  cancelado: "neutral",
  pendente_aprovacao: "warning",
  aprovado: "success",
  finalizado: "success",
  rejeitado: "danger",
  pc_lancado: "primary",
  nf_entrada: "primary",
  pagamento: "primary",
};

export function StatusOriginChip({
  status,
  label,
  origin,
  erpLabel = "SAP",
  className,
}: {
  status: string;
  /** Rótulo já traduzido para o contexto (compras x vendas). */
  label: string;
  origin?: DocOrigin;
  erpLabel?: string;
  className?: string;
}) {
  const tone = TONE_CLASSES[STATUS_TONES[status] ?? "neutral"];
  const originText = origin === "erp_flow" ? "Flow" : origin === "erp" ? erpLabel : null;
  const originTitle = origin === "erp_flow" ? "Criado no ERP Flow" : origin === "erp" ? `Criado no ${erpLabel}` : undefined;

  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-stretch overflow-hidden rounded-md border text-[11px] font-medium",
        tone.shell,
        status === "cancelado" && "line-through",
        className,
      )}
      title={originTitle ? `${label} · ${originTitle}` : label}
    >
      <span className={cn("flex items-center truncate px-2 leading-none", tone.label)}>{label}</span>
      {originText && (
        <span
          className={cn(
            "flex shrink-0 items-center border-l px-1.5 text-[9px] font-bold uppercase tracking-tight leading-none",
            tone.origin,
          )}
        >
          {originText}
        </span>
      )}
    </span>
  );
}
