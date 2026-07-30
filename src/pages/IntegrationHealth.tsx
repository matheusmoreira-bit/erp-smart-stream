import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, RefreshCw, Loader2, AlertTriangle, Database, Server, CreditCard, Receipt } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { cn } from "@/lib/utils";

type ProviderKey = "sap_sl" | "hana" | "pagcorp" | "mastertax";

interface HealthRow {
  provider: ProviderKey;
  function_name: string;
  total: number;
  errors: number;
  error_rate: number | null;
  avg_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  last_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
}

interface FailureRow {
  id: number;
  function_name: string;
  started_at: string;
  duration_ms: number;
  status_code: number | null;
  company_db: string | null;
  error_code: string | null;
}

const PROVIDERS: { key: ProviderKey; label: string; hint: string; icon: typeof Server }[] = [
  { key: "sap_sl", label: "SAP Service Layer", hint: "Lançamentos, baixas e consultas via Service Layer", icon: Server },
  { key: "hana", label: "HanaAPI V2", hint: "Views analíticas (VW_*) com fallback de IP", icon: Database },
  { key: "pagcorp", label: "PagCorp", hint: "Cartões corporativos e conciliação", icon: CreditCard },
  { key: "mastertax", label: "Master Tax", hint: "Captura de documentos fiscais", icon: Receipt },
];

const WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
];

const fmtMs = (v: number | null | undefined) => (v == null ? "—" : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`);
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR") : "—");
const fmtRate = (v: number | null) => (v == null ? "—" : `${Number(v).toFixed(2)}%`);

function statusOf(rows: HealthRow[]): { label: string; tone: string } {
  if (rows.length === 0) return { label: "sem dados", tone: "bg-muted text-muted-foreground" };
  const total = rows.reduce((a, r) => a + Number(r.total), 0);
  const errors = rows.reduce((a, r) => a + Number(r.errors), 0);
  const rate = total ? (100 * errors) / total : 0;
  const p95 = Math.max(...rows.map((r) => Number(r.p95_ms ?? 0)));
  if (rate > 10) return { label: "degradado", tone: "bg-destructive/15 text-destructive border-destructive/30" };
  if (rate > 2 || p95 > 15_000) return { label: "atenção", tone: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
  return { label: "saudável", tone: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" };
}

function toneRate(v: number | null) {
  if (v == null) return "";
  if (v > 10) return "text-destructive";
  if (v > 2) return "text-amber-600";
  return "text-emerald-600";
}

function toneLatency(v: number | null) {
  if (v == null) return "";
  if (v > 15_000) return "text-destructive";
  if (v > 6_000) return "text-amber-600";
  return "text-emerald-600";
}

export default function IntegrationHealth() {
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - hours * 3600_000).toISOString();
      const [health, fails] = await Promise.all([
        supabase.rpc("get_integration_health" as never, { _hours: hours } as never),
        supabase
          .from("edge_function_metrics")
          .select("id, function_name, started_at, duration_ms, status_code, company_db, error_code")
          .eq("ok", false)
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .limit(30),
      ]);
      if (health.error) throw health.error;
      if (fails.error) throw fails.error;
      setRows((health.data ?? []) as unknown as HealthRow[]);
      setFailures((fails.data ?? []) as FailureRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const byProvider = useMemo(() => {
    const map = new Map<ProviderKey, HealthRow[]>();
    for (const p of PROVIDERS) map.set(p.key, []);
    for (const r of rows) map.get(r.provider)?.push(r);
    return map;
  }, [rows]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <BackofficePageHeader
        title="Saúde das Integrações"
        description="Painel único de SAP Service Layer, HanaAPI V2, PagCorp e Master Tax: latência, taxa de erro e última execução."
        icon={<Activity className="h-5 w-5 text-muted-foreground" />}
        actions={
          <div className="flex items-center gap-1">
            {WINDOWS.map((w) => (
              <Button key={w.hours} size="sm" variant={hours === w.hours ? "default" : "ghost"} onClick={() => setHours(w.hours)}>
                {w.label}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span className="ml-2">Atualizar</span>
            </Button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PROVIDERS.map((p) => {
          const list = byProvider.get(p.key) ?? [];
          const total = list.reduce((a, r) => a + Number(r.total), 0);
          const errors = list.reduce((a, r) => a + Number(r.errors), 0);
          const rate = total ? (100 * errors) / total : null;
          const p95 = list.length ? Math.max(...list.map((r) => Number(r.p95_ms ?? 0))) : null;
          const p50 = list.length
            ? Math.round(list.reduce((a, r) => a + Number(r.p50_ms ?? 0) * Number(r.total), 0) / (total || 1))
            : null;
          const last = list.reduce<string | null>((acc, r) => (r.last_at && (!acc || r.last_at > acc) ? r.last_at : acc), null);
          const st = statusOf(list);
          const Icon = p.icon;
          return (
            <Card key={p.key}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    {p.label}
                  </CardTitle>
                  <Badge variant="outline" className={cn("text-[10px]", st.tone)}>{st.label}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{p.hint}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Chamadas</span>
                  <span className="font-medium">{total || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taxa de erro</span>
                  <span className={cn("font-medium", toneRate(rate))}>{fmtRate(rate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Latência p50 / p95</span>
                  <span className={cn("font-medium", toneLatency(p95))}>
                    {fmtMs(p50)} / {fmtMs(p95)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Última execução</span>
                  <span className="text-xs">{fmtDate(last)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalhe por função</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Integração</TableHead>
                <TableHead>Função</TableHead>
                <TableHead className="text-right">Chamadas</TableHead>
                <TableHead className="text-right">Erros</TableHead>
                <TableHead className="text-right">Taxa</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">Média</TableHead>
                <TableHead>Última execução</TableHead>
                <TableHead>Último erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.provider}-${r.function_name}`}>
                  <TableCell className="text-xs">
                    {PROVIDERS.find((p) => p.key === r.provider)?.label ?? r.provider}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.function_name}</TableCell>
                  <TableCell className="text-right">{r.total}</TableCell>
                  <TableCell className="text-right">{r.errors}</TableCell>
                  <TableCell className={cn("text-right", toneRate(r.error_rate))}>{fmtRate(r.error_rate)}</TableCell>
                  <TableCell className="text-right">{fmtMs(r.p50_ms)}</TableCell>
                  <TableCell className={cn("text-right", toneLatency(r.p95_ms))}>{fmtMs(r.p95_ms)}</TableCell>
                  <TableCell className="text-right">{fmtMs(r.avg_ms)}</TableCell>
                  <TableCell className="text-xs">{fmtDate(r.last_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.last_error_at ? `${fmtDate(r.last_error_at)}${r.last_error_code ? ` · ${r.last_error_code}` : ""}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    Nenhuma métrica coletada nesta janela.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Falhas recentes</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Base</TableHead>
                <TableHead className="text-right">Duração</TableHead>
                <TableHead className="text-right">HTTP</TableHead>
                <TableHead>Código</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="text-xs">{fmtDate(f.started_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{f.function_name}</TableCell>
                  <TableCell className="text-xs">{f.company_db ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmtMs(f.duration_ms)}</TableCell>
                  <TableCell className="text-right">{f.status_code ?? "—"}</TableCell>
                  <TableCell className="text-xs text-destructive">{f.error_code ?? "—"}</TableCell>
                </TableRow>
              ))}
              {failures.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhuma falha registrada nesta janela.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <IntegrationHealthAlerts />
    </div>

  );
}
