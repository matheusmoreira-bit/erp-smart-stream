import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePayResults, type PayResultFilters } from "@/hooks/useAuditPay";
import { FINDING_LABELS, PaySeverityBadge, SEVERITY_LABELS, formatBRL } from "./badges";

const SEVERITIES = Object.keys(SEVERITY_LABELS);

export function PayAuditResults() {
  const [filters, setFilters] = useState<PayResultFilters>({});
  const [showFilters, setShowFilters] = useState(true);
  const { data, isLoading } = usePayResults(filters);

  const set = (patch: Partial<PayResultFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Resultados</h2>
          <p className="text-sm text-muted-foreground">Documentos auditados, fatiáveis por qualquer dimensão.</p>
        </div>
        <Button variant="outline" onClick={() => setShowFilters((v) => !v)}>
          <Filter className="mr-2 h-4 w-4" /> Filtros
        </Button>
      </div>

      {showFilters && (
        <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input placeholder="Fornecedor (código ou nome)" value={filters.fornecedor ?? ""} onChange={(e) => set({ fornecedor: e.target.value || undefined })} />
            <Input placeholder="Solicitante" value={filters.solicitante ?? ""} onChange={(e) => set({ solicitante: e.target.value || undefined })} />
            <Input placeholder="Projeto" value={filters.projeto ?? ""} onChange={(e) => set({ projeto: e.target.value || undefined })} />
            <Input placeholder="Centro de custo" value={filters.centroCusto ?? ""} onChange={(e) => set({ centroCusto: e.target.value || undefined })} />
            <Input type="date" value={filters.dateFrom ?? ""} onChange={(e) => set({ dateFrom: e.target.value || undefined })} />
            <Input type="date" value={filters.dateTo ?? ""} onChange={(e) => set({ dateTo: e.target.value || undefined })} />
            <Input type="number" placeholder="Valor mínimo" value={filters.minValor ?? ""} onChange={(e) => set({ minValor: e.target.value ? Number(e.target.value) : undefined })} />
            <Input type="number" placeholder="Valor máximo" value={filters.maxValor ?? ""} onChange={(e) => set({ maxValor: e.target.value ? Number(e.target.value) : undefined })} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                onClick={() => set({ severity: filters.severity === s ? undefined : s })}
                className={`rounded-full border px-3 py-1 text-xs ${
                  filters.severity === s ? "border-primary/30 bg-primary/15 text-primary" : "border-transparent bg-muted/40 text-muted-foreground"
                }`}
              >
                {SEVERITY_LABELS[s as keyof typeof SEVERITY_LABELS].label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {Object.entries(FINDING_LABELS).map(([k, label]) => (
              <button
                key={k}
                onClick={() => set({ findingType: filters.findingType === k ? undefined : k })}
                className={`rounded-full border px-3 py-1 text-xs ${
                  filters.findingType === k ? "border-primary/30 bg-primary/15 text-primary" : "border-transparent bg-muted/40 text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={!!filters.onlyFindings} onChange={(e) => set({ onlyFindings: e.target.checked || undefined })} />
              Somente com divergência
            </label>
            <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
              <X className="mr-1 h-3.5 w-3.5" /> Limpar
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card/60">
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : !data || data.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Nenhum resultado para os filtros aplicados.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((r) => (
              <li key={r.id}>
                <Link to={`/auditoria/geral/pay-results/${r.id}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{r.document_ref}</span>
                      <PaySeverityBadge severity={r.overall_severity} />
                      <span className="rounded border border-border bg-muted/40 px-1.5 text-[10px] text-muted-foreground">risco {r.risk_score}</span>
                    </div>
                    <div className="mt-1 truncate text-sm text-foreground">{r.fornecedor_name ?? r.fornecedor_code ?? "—"}</div>
                    <div className="mt-0.5 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      <span>{r.solicitante ?? "—"}</span>
                      <span>CC {r.centro_custo ?? "—"}</span>
                      <span>Proj. {r.projeto ?? "—"}</span>
                      <span>{new Date(r.audited_at).toLocaleString("pt-BR")}</span>
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="font-mono text-sm text-foreground">{formatBRL(r.valor_pago)}</div>
                    <div className={`text-[11px] ${Number(r.desvio_valor_abs) === 0 ? "text-muted-foreground" : "text-amber-400"}`}>
                      {Number(r.desvio_valor_abs) >= 0 ? "+" : ""}
                      {formatBRL(r.desvio_valor_abs)} ({Number(r.desvio_valor_pct).toFixed(2)}%)
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
