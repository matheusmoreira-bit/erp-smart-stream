import { List, type RowComponentProps } from "react-window";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Eye, Network } from "lucide-react";
import { type Expense, STATUS_COLORS, STATUS_LABELS } from "@/hooks/useExpenses";

function formatCurrency(value: number, currency: string = "BRL") {
  const validCode = /^[A-Z]{3}$/.test(currency) ? currency : "BRL";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: validCode }).format(value);
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

export type VirtualRow = { exp: Expense; origin?: "erp_flow" | "erp" };

// Grid template shared by header and rows so columns stay aligned.
const GRID_COLS =
  "grid-cols-[minmax(140px,180px)_minmax(180px,260px)_minmax(140px,1fr)_120px_120px_120px_140px_100px]";

const ROW_HEIGHT = 52;

type RowProps = {
  items: VirtualRow[];
  erpLabel: string;
  onOpen: (exp: Expense, origin?: "erp_flow" | "erp") => void;
  onRelations: (exp: Expense) => void;
};

function VirtualRowComponent({
  index,
  style,
  items,
  onOpen,
  onRelations,
}: RowComponentProps<RowProps>) {
  const row = items[index];
  if (!row) return null;
  const { exp, origin } = row;
  return (
    <div
      style={style}
      role="row"
      tabIndex={0}
      onClick={() => onOpen(exp, origin)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(exp, origin);
        }
      }}
      className={`grid ${GRID_COLS} items-center gap-x-3 border-t border-border/60 hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none cursor-pointer transition-colors px-4 text-sm`}
    >
      <div role="cell" className="flex flex-wrap items-center gap-1.5 min-w-0">
        <Badge className={STATUS_COLORS[exp.status]}>{STATUS_LABELS[exp.status]}</Badge>
        {origin === "erp_flow" && (
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">ERP Flow</Badge>
        )}
        {origin === "erp" && (
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">ERP</Badge>
        )}
      </div>
      <div role="cell" className="flex items-center gap-2 text-foreground min-w-0">
        <Building2 className="w-3.5 h-3.5 text-primary/70 shrink-0" aria-hidden="true" />
        <span className="truncate">{exp.supplier_name}</span>
      </div>
      <div role="cell" className="text-foreground truncate">{exp.requester_name}</div>
      <div role="cell" className="text-muted-foreground whitespace-nowrap">{formatDate(exp.created_at)}</div>
      <div role="cell" className="text-muted-foreground whitespace-nowrap">
        {exp.doc_date ? formatDate(exp.doc_date) : "—"}
      </div>
      <div
        role="cell"
        className={`whitespace-nowrap ${exp.due_date ? "text-foreground" : "text-destructive font-medium"}`}
      >
        {exp.due_date ? formatDate(exp.due_date) : "sem data"}
      </div>
      <div role="cell" className="text-right font-mono font-semibold text-foreground whitespace-nowrap">
        {formatCurrency(exp.total_amount, exp.currency)}
      </div>
      <div role="cell" className="text-right">
        <div className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary"
            aria-label={`Abrir lançamento de ${exp.supplier_name}`}
            title="Ver detalhes"
            onClick={(ev) => { ev.stopPropagation(); onOpen(exp, origin); }}
          >
            <Eye className="w-4 h-4" aria-hidden="true" />
          </Button>
          {origin === "erp_flow" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-primary"
              aria-label={`Mapa de relações de ${exp.supplier_name}`}
              title="Mapa de relações"
              onClick={(ev) => { ev.stopPropagation(); onRelations(exp); }}
            >
              <Network className="w-4 h-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function VirtualExpensesTable({
  items,
  header,
  onOpen,
  onRelations,
  maxHeight = 640,
}: {
  items: VirtualRow[];
  header: React.ReactNode;
  onOpen: (exp: Expense, origin?: "erp_flow" | "erp") => void;
  onRelations: (exp: Expense) => void;
  maxHeight?: number;
}) {
  const visibleHeight = Math.min(maxHeight, items.length * ROW_HEIGHT + 8);
  return (
    <div role="table" aria-rowcount={items.length + 1} aria-label="Lançamentos (lista virtualizada)">
      {/* Header */}
      <div
        role="row"
        className={`grid ${GRID_COLS} items-center gap-x-3 bg-muted/40 text-muted-foreground px-4`}
      >
        {header}
      </div>
      {/* Virtualized body */}
      <div style={{ height: visibleHeight }}>
        <List
          rowComponent={VirtualRowComponent}
          rowCount={items.length}
          rowHeight={ROW_HEIGHT}
          rowProps={{ items, onOpen, onRelations }}
          overscanCount={6}
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    </div>
  );
}

export const VIRTUAL_GRID_COLS = GRID_COLS;
