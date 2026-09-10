import { cn } from "@/lib/utils";

/**
 * Chip único no mesmo padrão visual de `StatusOriginChip`:
 * {Tipo de Documento} | {Origem}
 * Cada natureza de documento tem a sua própria cor.
 */
export type DocKind = "purchase" | "sales" | "advance" | "pagcorp" | "other";

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  purchase: "Compra",
  sales: "Venda",
  advance: "Adiantamento",
  pagcorp: "Cartão Corp.",
  other: "Outro",
};

const KIND_CLASSES: Record<DocKind, { shell: string; label: string; origin: string }> = {
  purchase: {
    shell: "border-emerald-500/30 bg-emerald-500/10",
    label: "text-emerald-600 dark:text-emerald-400",
    origin: "bg-emerald-600 text-white border-emerald-500/30",
  },
  sales: {
    shell: "border-sky-500/30 bg-sky-500/10",
    label: "text-sky-600 dark:text-sky-400",
    origin: "bg-sky-600 text-white border-sky-500/30",
  },
  advance: {
    shell: "border-amber-500/35 bg-amber-500/10",
    label: "text-amber-600 dark:text-amber-400",
    origin: "bg-amber-600 text-white border-amber-500/30",
  },
  pagcorp: {
    shell: "border-violet-500/30 bg-violet-500/10",
    label: "text-violet-600 dark:text-violet-400",
    origin: "bg-violet-600 text-white border-violet-500/30",
  },
  other: {
    shell: "border-border bg-muted/40",
    label: "text-muted-foreground",
    origin: "bg-muted-foreground/70 text-background border-border",
  },
};

export function DocKindOriginChip({
  kind,
  origin,
  erpLabel = "SAP",
  title,
  className,
}: {
  kind: DocKind;
  /** "flow" para documentos criados no ERP Flow, "erp" para documentos nativos. */
  origin?: "flow" | "erp" | null;
  erpLabel?: string;
  title?: string;
  className?: string;
}) {
  const tone = KIND_CLASSES[kind] ?? KIND_CLASSES.other;
  const label = DOC_KIND_LABEL[kind] ?? DOC_KIND_LABEL.other;
  const originText = origin === "flow" ? "Flow" : origin === "erp" ? erpLabel : null;

  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-stretch overflow-hidden rounded-md border text-[11px] font-medium",
        tone.shell,
        className,
      )}
      title={title ?? (originText ? `${label} · Criado no ${originText === "Flow" ? "ERP Flow" : erpLabel}` : label)}
    >
      <span className={cn("flex items-center truncate px-2 uppercase tracking-wide leading-none", tone.label)}>
        {label}
      </span>
      {originText && (
        <span
          className={cn(
            "flex shrink-0 items-center border-l px-1.5 text-[9px] font-bold uppercase tracking-tight leading-none",
            originSegmentClasses(originText, tone.origin),
          )}
        >
          {originText}
        </span>
      )}
    </span>
  );
}
