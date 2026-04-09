import { Loader2, RefreshCw } from "lucide-react";
import { usePaymentAnalysis } from "@/hooks/usePaymentAnalysis";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export function PaymentAnalysis() {
  const { rows, isLoading, error, refresh } = usePaymentAnalysis();
  const [search, setSearch] = useState("");

  const filtered = search
    ? rows.filter((r) => {
        const q = search.toLowerCase();
        return (
          String(r.DocNum || "").includes(q) ||
          (r.CardName || "").toLowerCase().includes(q) ||
          (r.CardCode || "").toLowerCase().includes(q)
        );
      })
    : rows;

  // Detect columns dynamically from first row
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  if (error) {
    return (
      <div className="glass-card p-4 border-destructive/30 bg-destructive/10 text-sm text-destructive">
        {error}
        <Button variant="ghost" size="sm" onClick={refresh} className="ml-2">
          <RefreshCw className="w-4 h-4 mr-1" /> Tentar novamente
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Carregando análise de pagamentos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Buscar por nº documento, fornecedor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} registros</span>
          <Button variant="ghost" size="sm" onClick={refresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="glass-card p-8 text-center text-muted-foreground">
          Nenhum dado encontrado na view VW_ANALISE_PAGAMENTOS_DETALHADO.
        </div>
      ) : (
        <div className="glass-card overflow-auto max-h-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead key={col} className="whitespace-nowrap text-xs">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 200).map((row, idx) => (
                <TableRow key={idx}>
                  {columns.map((col) => (
                    <TableCell key={col} className="whitespace-nowrap text-xs">
                      {formatCell(row[col])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString("pt-BR");
    return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Date(value).toLocaleDateString("pt-BR");
  }
  return String(value);
}
