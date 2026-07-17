import { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  title: string;
  subtitle?: string;
  count: number;
  total: number;
  accent: "destructive" | "success" | "warning";
  children: ReactNode;
  emptyLabel?: string;
}

const ACCENT: Record<Props["accent"], string> = {
  destructive: "bg-destructive/10 text-destructive border-destructive/30",
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-600 border-amber-500/30",
};

function money(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function KanbanColumn({ title, subtitle, count, total, accent, children, emptyLabel }: Props) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-muted/20 min-h-[400px] lg:h-[calc(100vh-260px)]">
      <div className={`px-3 py-2 border-b rounded-t-lg ${ACCENT[accent]}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{title}</div>
            {subtitle && <div className="text-[11px] opacity-80 truncate">{subtitle}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-bold tabular-nums leading-none">{count}</div>
            <div className="text-[10px] tabular-nums opacity-80">{money(total)}</div>
          </div>
        </div>
      </div>
      <ScrollArea className="flex-1 p-2">
        {count === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground py-12 text-center px-4">
            {emptyLabel || "Sem registros nesta raia."}
          </div>
        ) : (
          <div className="space-y-2">{children}</div>
        )}
      </ScrollArea>
    </div>
  );
}
