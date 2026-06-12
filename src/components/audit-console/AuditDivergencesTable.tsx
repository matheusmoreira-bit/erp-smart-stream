import { useState } from "react";
import { Search, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuditDivergences, type DivergenceFilters } from "@/hooks/useAuditConsole";
import { SeverityBadge, DIVERGENCE_TYPE_LABELS } from "./badges";

interface Props {
  runId?: string;
  embedded?: boolean;
}

const SEVERITIES: DivergenceFilters["severity"][] = ["critical", "high", "medium", "low"];

export function AuditDivergencesTable({ runId, embedded = false }: Props) {
  const [filters, setFilters] = useState<DivergenceFilters>({});
  const [search, setSearch] = useState("");
  const { data, isLoading } = useAuditDivergences({ ...filters, runId, cardCode: search || undefined });

  return (
    <div className="space-y-4">
      {!embedded && (
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Divergências</h2>
          <p className="text-sm text-muted-foreground">
            Lista global de divergências detectadas. Use os filtros para investigar.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por código de fornecedor…"
            className="pl-8"
          />
        </div>

        <Select
          value={filters.severity ?? "all"}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, severity: v === "all" ? undefined : (v as DivergenceFilters["severity"]) }))
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Severidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas severidades</SelectItem>
            {SEVERITIES.map((s) => (
              <SelectItem key={s} value={s!}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.type ?? "all"}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, type: v === "all" ? undefined : (v as DivergenceFilters["type"]) }))
          }
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {Object.entries(DIVERGENCE_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, fraudOnly: !f.fraudOnly }))}
          className={`inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs transition-colors ${
            filters.fraudOnly
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-card/40 text-muted-foreground hover:bg-muted/40"
          }`}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          Apenas fraude
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card/60">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card/95 backdrop-blur">
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Severidade</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Fornecedor</th>
                <th className="px-4 py-2 font-medium">Descrição</th>
                <th className="px-4 py-2 text-right font-medium">Δ valor</th>
                <th className="px-4 py-2 font-medium">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-3">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : !data || data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-xs text-muted-foreground">
                    Nenhuma divergência encontrada com os filtros atuais.
                  </td>
                </tr>
              ) : (
                data.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <SeverityBadge severity={d.severity} />
                    </td>
                    <td className="px-4 py-2 text-xs text-foreground">
                      {DIVERGENCE_TYPE_LABELS[d.divergence_type] ?? d.divergence_type}
                      {d.is_fraud_flag && (
                        <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-destructive/15 px-1 py-0.5 text-[10px] text-destructive">
                          <ShieldAlert className="h-2.5 w-2.5" /> fraude
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {d.card_code ?? "—"}
                    </td>
                    <td className="max-w-md px-4 py-2 text-xs text-foreground">
                      <span className="line-clamp-2">{d.description}</span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-foreground">
                      {d.delta_value != null
                        ? d.delta_value.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
