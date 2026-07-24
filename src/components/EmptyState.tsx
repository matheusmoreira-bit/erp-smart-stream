import { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Estado vazio padrão do sistema. Use em listas, tabelas e cards
 * quando não há dados para exibir. Coerente entre módulos.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-2 py-10 px-4 rounded-lg border border-dashed border-border bg-muted/20",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="p-2 rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description ? (
        <p className="text-xs text-muted-foreground max-w-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
