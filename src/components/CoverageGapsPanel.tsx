import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  scanCoverage,
  coverageToCsv,
  type CoverageResult,
} from "@/lib/approval-coverage";
import type { ApprovalRule, RuleDocType } from "@/hooks/useApprovalRules";

const LAST_SCAN_KEY = "approval-coverage:last-scan";

interface Combo {
  costCenter: string;
  project: string | null;
  docCount: number;
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

/**
 * Varredura de cobertura da matriz: aponta CC/projeto/faixa sem regra ativa
 * ANTES de um documento cair no aprovador padrão de contingência.
 */
export function CoverageGapsPanel({ rules }: { rules: ApprovalRule[] }) {
  const { session } = useSap();
  const companyDb = session?.companyDB || "";
  const [loading, setLoading] = useState(false);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [docTypes, setDocTypes] = useState<RuleDocType[]>(["purchase"]);
  const [result, setResult] = useState<CoverageResult | null>(null);
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<string | null>(() => localStorage.getItem(LAST_SCAN_KEY));

  const loadScope = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    setError(null);
    try {
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { data, error: err } = await supabase
        .from("expenses")
        .select("cost_center, project, doc_type, expense_items(cost_center, project)")
        .eq("company_db", companyDb)
        .gte("created_at", since.toISOString())
        .limit(3000);
      if (err) throw err;

      const map = new Map<string, Combo>();
      const types = new Set<RuleDocType>();
      for (const row of (data || []) as any[]) {
        const dt: RuleDocType = row.doc_type === "sales" ? "sales" : "purchase";
        types.add(dt);
        const pairs: { cc: string; pj: string | null }[] = [];
        const items = Array.isArray(row.expense_items) ? row.expense_items : [];
        for (const it of items) {
          if (it?.cost_center) pairs.push({ cc: String(it.cost_center), pj: it.project || row.project || null });
        }
        if (pairs.length === 0 && row.cost_center) {
          pairs.push({ cc: String(row.cost_center), pj: row.project || null });
        }
        for (const p of pairs) {
          const key = `${p.cc}|${p.pj ?? ""}`;
          const prev = map.get(key);
          if (prev) prev.docCount += 1;
          else map.set(key, { costCenter: p.cc, project: p.pj, docCount: 1 });
        }
      }
      setCombos(Array.from(map.values()));
      setDocTypes(types.size ? Array.from(types) : ["purchase"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar o universo de documentos");
    } finally {
      setLoading(false);
    }
  }, [companyDb]);

  useEffect(() => { void loadScope(); }, [loadScope]);

  const runScan = useCallback(() => {
    if (combos.length === 0) return;
    const res = scanCoverage(rules, { combos, docTypes });
    setResult(res);
    setLastScan(res.scannedAt);
    localStorage.setItem(LAST_SCAN_KEY, res.scannedAt);
  }, [rules, combos, docTypes]);

  // Varredura automática sempre que o universo ou a matriz mudarem.
  useEffect(() => {
    if (combos.length > 0 && rules.length > 0) runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combos, rules]);

  const visible = useMemo(() => {
    const gaps = result?.gaps || [];
    return onlyCritical ? gaps.filter((g) => g.severity === "critical") : gaps;
  }, [result, onlyCritical]);

  const exportCsv = useCallback(() => {
    const csv = coverageToCsv(visible);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cobertura-alcadas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [visible]);

  const coveragePct = result && result.scanned > 0
    ? Math.round((result.covered / result.scanned) * 100)
    : null;

  return (
    <div className="glass-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            Alerta de alçada sem cobertura
          </h3>
          <p className="text-xs text-muted-foreground">
            Varredura dos centros de custo, projetos e faixas de valor usados nos últimos 12 meses.
            Última varredura: {fmtDateTime(lastScan)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-2">
            <Switch id="cov-crit" checked={onlyCritical} onCheckedChange={setOnlyCritical} />
            <Label htmlFor="cov-crit" className="text-xs">Só críticos</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadScope()} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Varrer agora
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </p>
      )}

      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            { label: "Cenários testados", value: String(result.scanned) },
            { label: "Cobertura", value: coveragePct === null ? "—" : `${coveragePct}%` },
            { label: "Críticos (contingência)", value: String(result.critical) },
            { label: "Atenção (fallback do ramo)", value: String(result.warning) },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="text-lg font-bold font-mono">{c.value}</div>
              <div className="text-[11px] text-muted-foreground">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading && !result ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando universo de documentos…
        </p>
      ) : !result || combos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum documento recente para varrer nesta empresa.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-success" />
          Toda combinação observada de centro de custo, projeto e faixa de valor tem regra ativa.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 max-h-[420px] overflow-y-auto">
          {visible.map((g) => (
            <li key={g.key} className="p-3 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={g.severity === "critical" ? "destructive" : "outline"}>
                  {g.severity === "critical" ? "Contingência" : "Fallback do ramo"}
                </Badge>
                <span className="font-mono text-xs font-semibold">{g.costCenter}</span>
                {g.project && <Badge variant="secondary" className="text-[10px]">{g.project}</Badge>}
                <Badge variant="outline" className="text-[10px]">
                  {g.docType === "sales" ? "Venda" : "Compra"}
                </Badge>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {g.docCount} doc(s) em 12 meses
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Sem regra ativa nas faixas: <span className="text-foreground">{g.bands.join(", ")}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {g.fallbackRuleName
                  ? `Cairia na alçada do ramo ${g.fallbackBranch} — regra "${g.fallbackRuleName}".`
                  : "Sem regra irmã no ramo: iria direto para o aprovador padrão de contingência."}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CoverageGapsPanel;
