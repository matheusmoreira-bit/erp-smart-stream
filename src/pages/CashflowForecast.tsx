import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Loader2, TrendingUp, AlertTriangle, FileDown } from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { sapFunctionFetch } from "@/lib/auth-fetch";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface CashflowRow {
  kind: "ap" | "ar";
  key: string;
  party: string | null;
  description: string | null;
  cost_center: string | null;
  project: string | null;
  due_date: string | null;
  amount: number;
  paid_date: string | null;
  paid_amount: number;
  doc_ref: string | null;
}

type Grouping = "month" | "week" | "cost_center" | "project";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function defaultRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 4, 0));
  return { from: isoDay(from), to: isoDay(to) };
}

/** Chave de agrupamento (semana ISO simplificada = segunda-feira da semana). */
function bucketOf(row: CashflowRow, grouping: Grouping): string {
  if (grouping === "cost_center") return row.cost_center?.trim() || "Sem centro de custo";
  if (grouping === "project") return row.project?.trim() || "Sem projeto";
  const due = row.due_date;
  if (!due) return "Sem vencimento";
  if (grouping === "month") return due.slice(0, 7);
  const d = new Date(`${due}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return isoDay(d);
}

function bucketLabel(bucket: string, grouping: Grouping): string {
  if (grouping === "month" && /^\d{4}-\d{2}$/.test(bucket)) {
    const [y, m] = bucket.split("-");
    return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString("pt-BR", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (grouping === "week" && /^\d{4}-\d{2}-\d{2}$/.test(bucket)) {
    return `Semana de ${new Date(`${bucket}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })}`;
  }
  return bucket;
}

interface Bucket {
  key: string;
  label: string;
  apForecast: number;
  apActual: number;
  arForecast: number;
  arActual: number;
}

/** Previsão de caixa por vencimento: contas a pagar × contas a receber, previsto × realizado. */
export default function CashflowForecast() {
  const navigate = useNavigate();
  const { session } = useSap();
  const companyDb = session?.companyDB;

  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [grouping, setGrouping] = useState<Grouping>("month");
  const [ccFilter, setCcFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const [rows, setRows] = useState<CashflowRow[]>([]);
  const [arNote, setArNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    setError(null);
    try {
      const res = await sapFunctionFetch("cashflow-forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_db: companyDb, from, to }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Falha ao carregar (${res.status}).`);
      setRows([...(json.ap || []), ...(json.ar || [])] as CashflowRow[]);
      setArNote(json.ar_source === "sap" ? null : (json.ar_note || "Contas a receber indisponível."));
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [companyDb, from, to]);

  useEffect(() => { void load(); }, [load]);

  const costCenters = useMemo(
    () => Array.from(new Set(rows.map((r) => r.cost_center?.trim()).filter(Boolean) as string[])).sort(),
    [rows],
  );
  const projects = useMemo(
    () => Array.from(new Set(rows.map((r) => r.project?.trim()).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (ccFilter === "all" || (r.cost_center?.trim() || "") === ccFilter) &&
          (projectFilter === "all" || (r.project?.trim() || "") === projectFilter),
      ),
    [rows, ccFilter, projectFilter],
  );

  const buckets = useMemo<Bucket[]>(() => {
    const map = new Map<string, Bucket>();
    for (const r of filtered) {
      const key = bucketOf(r, grouping);
      const b = map.get(key) ?? {
        key,
        label: bucketLabel(key, grouping),
        apForecast: 0,
        apActual: 0,
        arForecast: 0,
        arActual: 0,
      };
      if (r.kind === "ap") {
        b.apForecast += r.amount;
        b.apActual += r.paid_amount;
      } else {
        b.arForecast += r.amount;
        b.arActual += r.paid_amount;
      }
      map.set(key, b);
    }
    const list = Array.from(map.values());
    if (grouping === "month" || grouping === "week") list.sort((a, b) => a.key.localeCompare(b.key));
    else list.sort((a, b) => b.apForecast + b.arForecast - (a.apForecast + a.arForecast));
    return list;
  }, [filtered, grouping]);

  const totals = useMemo(
    () =>
      buckets.reduce(
        (acc, b) => ({
          apForecast: acc.apForecast + b.apForecast,
          apActual: acc.apActual + b.apActual,
          arForecast: acc.arForecast + b.arForecast,
          arActual: acc.arActual + b.arActual,
        }),
        { apForecast: 0, apActual: 0, arForecast: 0, arActual: 0 },
      ),
    [buckets],
  );

  const todayIso = isoDay(new Date());
  const overdueAp = useMemo(
    () =>
      filtered
        .filter((r) => r.kind === "ap" && !r.paid_date && (r.due_date ?? "") < todayIso)
        .reduce((s, r) => s + r.amount, 0),
    [filtered, todayIso],
  );

  const exportCsv = () => {
    const header = ["Período/Grupo", "A pagar previsto", "A pagar realizado", "A receber previsto", "A receber realizado", "Saldo previsto", "Saldo realizado"];
    const lines = buckets.map((b) =>
      [
        b.label,
        b.apForecast.toFixed(2),
        b.apActual.toFixed(2),
        b.arForecast.toFixed(2),
        b.arActual.toFixed(2),
        (b.arForecast - b.apForecast).toFixed(2),
        (b.arActual - b.apActual).toFixed(2),
      ].join(";"),
    );
    const blob = new Blob([[header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `previsao-caixa-${from}-a-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxAbs = Math.max(1, ...buckets.map((b) => Math.max(b.apForecast, b.arForecast)));

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Previsão de Caixa" />
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Previsão de caixa por vencimento</h1>
              <p className="text-sm text-muted-foreground">
                Contas a pagar e a receber consolidadas, com quebra por centro de custo/projeto e comparação com o realizado.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={buckets.length === 0}>
              <FileDown className="w-4 h-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={load} disabled={loading || !companyDb}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {!companyDb && (
          <div className="glass-card p-6 text-sm text-muted-foreground">
            Faça login em uma empresa para ver a previsão de caixa.
          </div>
        )}

        {companyDb && (
          <>
            <div className="glass-card p-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1" htmlFor="cf-from">De (vencimento)</label>
                <Input id="cf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1" htmlFor="cf-to">Até</label>
                <Input id="cf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Agrupar por</label>
                <Select value={grouping} onValueChange={(v) => setGrouping(v as Grouping)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Mês de vencimento</SelectItem>
                    <SelectItem value="week">Semana de vencimento</SelectItem>
                    <SelectItem value="cost_center">Centro de custo</SelectItem>
                    <SelectItem value="project">Projeto / Marca</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Centro de custo</label>
                <Select value={ccFilter} onValueChange={setCcFilter}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {costCenters.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Projeto</label>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <div className="glass-card p-4 text-sm text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {error}
              </div>
            )}
            {arNote && !error && (
              <div className="glass-card p-4 text-sm text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> {arNote} Os valores abaixo consideram apenas contas a pagar.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "A receber previsto", value: totals.arForecast, sub: `Realizado ${brl(totals.arActual)}` },
                { label: "A pagar previsto", value: totals.apForecast, sub: `Realizado ${brl(totals.apActual)}` },
                { label: "Saldo previsto", value: totals.arForecast - totals.apForecast, sub: `Realizado ${brl(totals.arActual - totals.apActual)}` },
                { label: "A pagar vencido em aberto", value: overdueAp, sub: "Vencimento anterior a hoje, sem pagamento" },
              ].map((kpi) => (
                <div key={kpi.label} className="glass-card p-4">
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  <p className={`text-xl font-bold mt-1 ${kpi.value < 0 ? "text-destructive" : "text-foreground"}`}>
                    {brl(kpi.value)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{kpi.sub}</p>
                </div>
              ))}
            </div>

            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-primary" aria-hidden />
                <h2 className="text-sm font-semibold text-foreground">Previsto × realizado</h2>
                <Badge variant="secondary" className="text-xs ml-auto">{filtered.length} lançamentos</Badge>
              </div>

              {loading && rows.length === 0 && (
                <p className="text-sm text-muted-foreground">Carregando dados financeiros...</p>
              )}
              {!loading && loaded && buckets.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum vencimento no período e filtros selecionados.
                </p>
              )}

              {buckets.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Período / Grupo</TableHead>
                        <TableHead className="text-right">A receber previsto</TableHead>
                        <TableHead className="text-right">A receber realizado</TableHead>
                        <TableHead className="text-right">A pagar previsto</TableHead>
                        <TableHead className="text-right">A pagar realizado</TableHead>
                        <TableHead className="text-right">Saldo previsto</TableHead>
                        <TableHead className="text-right">Saldo realizado</TableHead>
                        <TableHead className="w-40">Composição</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {buckets.map((b) => {
                        const saldo = b.arForecast - b.apForecast;
                        const saldoReal = b.arActual - b.apActual;
                        return (
                          <TableRow key={b.key}>
                            <TableCell className="font-medium">{b.label}</TableCell>
                            <TableCell className="text-right">{brl(b.arForecast)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{brl(b.arActual)}</TableCell>
                            <TableCell className="text-right">{brl(b.apForecast)}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{brl(b.apActual)}</TableCell>
                            <TableCell className={`text-right font-medium ${saldo < 0 ? "text-destructive" : "text-emerald-500"}`}>
                              {brl(saldo)}
                            </TableCell>
                            <TableCell className={`text-right ${saldoReal < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              {brl(saldoReal)}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1" aria-hidden>
                                <div className="h-1.5 rounded bg-emerald-500/70" style={{ width: `${(b.arForecast / maxAbs) * 100}%` }} />
                                <div className="h-1.5 rounded bg-destructive/70" style={{ width: `${(b.apForecast / maxAbs) * 100}%` }} />
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
