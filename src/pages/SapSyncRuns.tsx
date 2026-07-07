import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { RefreshCw, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { SapSyncHealthCard } from "@/components/SapSyncHealthCard";

interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string;
  trigger: string;
  processed_count: number;
  updated_count: number;
  error_count: number;
  skipped_count: number;
  results: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
  error_message: string | null;
}

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }) : "—";

const fmtDur = (ms: number | null) => {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

function statusBadge(status: string) {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    ok: "default",
    running: "secondary",
    error: "destructive",
  };
  return <Badge variant={map[status] ?? "outline"}>{status}</Badge>;
}

export default function SapSyncRuns() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [onlyWithErrors, setOnlyWithErrors] = useState(false);
  const [rows, setRows] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SyncRun | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("expense_sap_sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(500);
      if (from) q = q.gte("started_at", `${from}T00:00:00`);
      if (to) q = q.lte("started_at", `${to}T23:59:59`);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (onlyWithErrors) q = q.gt("error_count", 0);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data ?? []) as SyncRun[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to, statusFilter, onlyWithErrors]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => {
      acc.runs += 1;
      acc.processed += r.processed_count;
      acc.updated += r.updated_count;
      acc.errors += r.error_count;
      if (r.status === "error") acc.failedRuns += 1;
      return acc;
    }, { runs: 0, processed: 0, updated: 0, errors: 0, failedRuns: 0 });
  }, [rows]);

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <PageTitle title="Execuções da Sincronia SAP" />
        <Button asChild variant="outline" size="sm">
          <Link to="/backoffice/sap-sync">
            <ExternalLink className="mr-2 h-4 w-4" />
            Forçar sincronia
          </Link>
        </Button>
      </div>

      <SapSyncHealthCard />

      <Card>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
            <div className="space-y-1">
              <Label htmlFor="from">De</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to">Até</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ok">OK</SelectItem>
                  <SelectItem value="error">Erro</SelectItem>
                  <SelectItem value="running">Em execução</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Com erros</Label>
              <Select value={onlyWithErrors ? "yes" : "no"} onValueChange={(v) => setOnlyWithErrors(v === "yes")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">Todas</SelectItem>
                  <SelectItem value="yes">Só com erros</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Aplicar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Execuções" value={totals.runs} />
        <StatCard label="Com falha" value={totals.failedRuns} variant={totals.failedRuns ? "destructive" : "default"} />
        <StatCard label="Processadas" value={totals.processed} />
        <StatCard label="Atualizadas" value={totals.updated} />
        <StatCard label="Erros por item" value={totals.errors} variant={totals.errors ? "destructive" : "default"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execuções ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma execução no período selecionado.</p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Início</TableHead>
                    <TableHead>Duração</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Processadas</TableHead>
                    <TableHead className="text-right">Atualizadas</TableHead>
                    <TableHead className="text-right">Erros</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                      <TableCell className="text-xs">{fmtDate(r.started_at)}</TableCell>
                      <TableCell className="text-xs">{fmtDur(r.duration_ms)}</TableCell>
                      <TableCell><Badge variant="outline">{r.trigger}</Badge></TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-right">{r.processed_count}</TableCell>
                      <TableCell className="text-right">{r.updated_count}</TableCell>
                      <TableCell className="text-right">
                        {r.error_count > 0
                          ? <Badge variant="destructive">{r.error_count}</Badge>
                          : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>
                          Detalhes
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RunDetailDialog run={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function StatCard({ label, value, variant = "default" }: { label: string; value: number; variant?: "default" | "destructive" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${variant === "destructive" && value > 0 ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

interface ResultItem {
  id: string;
  docEntry?: number;
  poStatus?: string;
  expenseStatus?: string;
  error?: string;
  attempts?: number;
  nextRetryAt?: string | null;
}

function RunDetailDialog({ run, onClose }: { run: SyncRun | null; onClose: () => void }) {
  const [supplierMap, setSupplierMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!run) return;
    const ids = (run.results as unknown as ResultItem[]).map((r) => r.id).filter(Boolean);
    if (ids.length === 0) { setSupplierMap({}); return; }
    void supabase
      .from("expenses")
      .select("id, supplier_name")
      .in("id", ids)
      .then(({ data }) => {
        const m: Record<string, string> = {};
        for (const r of (data ?? []) as { id: string; supplier_name: string }[]) m[r.id] = r.supplier_name;
        setSupplierMap(m);
      });
  }, [run]);

  if (!run) return null;
  const items = (run.results ?? []) as unknown as ResultItem[];
  const errorsOnly = items.filter((r) => r.error);

  return (
    <Dialog open={!!run} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Execução {run.id.slice(0, 8)}
            {statusBadge(run.status)}
            <Badge variant="outline">{run.trigger}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><span className="text-muted-foreground">Início:</span> {fmtDate(run.started_at)}</div>
          <div><span className="text-muted-foreground">Fim:</span> {fmtDate(run.finished_at)}</div>
          <div><span className="text-muted-foreground">Duração:</span> {fmtDur(run.duration_ms)}</div>
          <div><span className="text-muted-foreground">Processadas:</span> {run.processed_count}</div>
        </div>

        {run.error_message && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <div className="font-medium mb-1">Erro geral</div>
            {run.error_message}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm">Erros por despesa</h3>
            <Badge variant={errorsOnly.length ? "destructive" : "secondary"}>{errorsOnly.length}</Badge>
          </div>
          {errorsOnly.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum erro por item nesta execução.</p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>DocEntry</TableHead>
                    <TableHead>Tentativas</TableHead>
                    <TableHead>Próx. retry</TableHead>
                    <TableHead>Erro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errorsOnly.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{supplierMap[r.id] ?? r.id.slice(0, 8)}</TableCell>
                      <TableCell>{r.docEntry ?? "—"}</TableCell>
                      <TableCell>{r.attempts ?? "—"}</TableCell>
                      <TableCell className="text-xs">{fmtDate(r.nextRetryAt ?? null)}</TableCell>
                      <TableCell className="text-destructive text-xs max-w-[360px]">{r.error}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Ver payload completo (JSON)</summary>
          <pre className="mt-2 p-3 rounded bg-muted overflow-x-auto max-h-72">
{JSON.stringify(run.results, null, 2)}
          </pre>
        </details>
      </DialogContent>
    </Dialog>
  );
}
