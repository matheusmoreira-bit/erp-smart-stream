import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCw, X, PlayCircle, TrendingUp, AlertTriangle, CheckCircle2, Clock, History, Send, Search } from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";

type MetricsRow = {
  doc_type: string;
  error_category: string | null;
  status: string;
  total: number;
  avg_attempts: number;
};

type Row = {
  id: string;
  doc_type: string;
  ref_id: string;
  company_db: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  error_category: string | null;
  status: "pending" | "in_flight" | "succeeded" | "exhausted" | "cancelled";
  created_at: string;
  updated_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  in_flight: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  succeeded: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  exhausted: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function fmtDate(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR");
}

export default function BackofficeRetryQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [metrics, setMetrics] = useState<MetricsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [windowHours, setWindowHours] = useState<number>(24);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [dispatching, setDispatching] = useState(false);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("sap_retry_queue").select("*").order("updated_at", { ascending: false }).limit(200);
    if (statusFilter === "active") q = q.in("status", ["pending", "in_flight", "exhausted"]);
    else if (statusFilter !== "all") q = q.eq("status", statusFilter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setRows((data as Row[]) || []);

    // Métricas agregadas na janela (últimas N horas por updated_at).
    const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
    const { data: mdata } = await supabase
      .from("sap_retry_queue")
      .select("doc_type, error_category, status, attempts")
      .gte("updated_at", since)
      .limit(5000);
    const agg = new Map<string, MetricsRow>();
    for (const r of (mdata || []) as { doc_type: string; error_category: string | null; status: string; attempts: number }[]) {
      const k = `${r.doc_type}|${r.error_category || "-"}|${r.status}`;
      const cur = agg.get(k) || { doc_type: r.doc_type, error_category: r.error_category, status: r.status, total: 0, avg_attempts: 0 };
      cur.total += 1;
      cur.avg_attempts = (cur.avg_attempts * (cur.total - 1) + (r.attempts || 0)) / cur.total;
      agg.set(k, cur);
    }
    setMetrics(Array.from(agg.values()).sort((a, b) => b.total - a.total));

    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter, windowHours]);

  useEffect(() => {
    const channel = supabase
      .channel("sap_retry_queue_watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "sap_retry_queue" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Só pode existir 1 item ativo (pending/in_flight) por doc_type+ref_id (índice único parcial).
  const activeKeys = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      if (r.status === "pending" || r.status === "in_flight") s.add(`${r.doc_type}::${r.ref_id}`);
    });
    return s;
  }, [rows]);

  const retryNow = async (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (row && row.status !== "pending" && row.status !== "in_flight" && activeKeys.has(`${row.doc_type}::${row.ref_id}`)) {
      toast.error("Já existe uma tentativa ativa para este documento");
      return;
    }
    const { error } = await supabase
      .from("sap_retry_queue")
      .update({ status: "pending", next_attempt_at: new Date().toISOString(), notified_exhausted_at: null })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Reagendado para agora");
      // Dispara o worker imediatamente
      await supabase.functions.invoke("sap-retry-worker").catch(() => {});
    }
  };


  const cancel = async (id: string) => {
    const { error } = await supabase.from("sap_retry_queue").update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Cancelado");
  };

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.doc_type, r.company_db, r.ref_id, r.error_category, r.last_error]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [rows, search]);

  const dispatchableIds = useMemo(
    () => visibleRows.filter((r) => r.status === "pending" || r.status === "exhausted" || r.status === "cancelled").map((r) => r.id),
    [visibleRows],
  );

  const selectedDispatchable = useMemo(
    () => selected.filter((id) => dispatchableIds.includes(id)),
    [selected, dispatchableIds],
  );

  const toggleRow = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAll = () =>
    setSelected((prev) => (dispatchableIds.every((id) => prev.includes(id)) ? [] : dispatchableIds));

  const dispatchSelected = async () => {
    if (selectedDispatchable.length === 0) return;
    setDispatching(true);
    const { error } = await supabase
      .from("sap_retry_queue")
      .update({ status: "pending", next_attempt_at: new Date().toISOString(), notified_exhausted_at: null })
      .in("id", selectedDispatchable);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${selectedDispatchable.length} item(ns) reenviado(s) para integração`);
      setSelected([]);
      await supabase.functions.invoke("sap-retry-worker").catch(() => {});
      load();
    }
    setDispatching(false);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [rows]);

  const summary = useMemo(() => {
    const total = metrics.reduce((s, m) => s + m.total, 0);
    const succeeded = metrics.filter(m => m.status === "succeeded").reduce((s, m) => s + m.total, 0);
    const exhausted = metrics.filter(m => m.status === "exhausted").reduce((s, m) => s + m.total, 0);
    const pending = metrics.filter(m => m.status === "pending" || m.status === "in_flight").reduce((s, m) => s + m.total, 0);
    const recovered = succeeded + exhausted;
    const successRate = recovered > 0 ? (succeeded / recovered) * 100 : 0;
    const avgAttempts = total > 0
      ? metrics.reduce((s, m) => s + m.avg_attempts * m.total, 0) / total
      : 0;
    const byCategory = new Map<string, number>();
    for (const m of metrics) {
      const k = m.error_category || "outros";
      byCategory.set(k, (byCategory.get(k) || 0) + m.total);
    }
    const topCategories = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const byDocType = new Map<string, { total: number; succeeded: number; exhausted: number }>();
    for (const m of metrics) {
      const cur = byDocType.get(m.doc_type) || { total: 0, succeeded: 0, exhausted: 0 };
      cur.total += m.total;
      if (m.status === "succeeded") cur.succeeded += m.total;
      if (m.status === "exhausted") cur.exhausted += m.total;
      byDocType.set(m.doc_type, cur);
    }
    return { total, succeeded, exhausted, pending, successRate, avgAttempts, topCategories, byDocType: Array.from(byDocType.entries()) };
  }, [metrics]);

  return (
    <div className="container mx-auto p-6 space-y-4">
      <BackofficePageHeader
        title="Histórico de Integrações SAP"
        description="Histórico de tentativas de integração com o SAP e reenvio manual em lote."
        icon={<History className="h-5 w-5 text-muted-foreground" />}
      />
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <div className="relative mr-auto w-full sm:w-72">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar empresa, documento ou erro"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar no histórico de integrações"
          />
        </div>
        <Button onClick={dispatchSelected} disabled={selectedDispatchable.length === 0 || dispatching}>
          <Send className="h-4 w-4 mr-2" />
          Reenviar selecionados{selectedDispatchable.length > 0 ? ` (${selectedDispatchable.length})` : ""}
        </Button>
        <Select value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Última hora</SelectItem>
            <SelectItem value="24">Últimas 24h</SelectItem>
            <SelectItem value="168">Últimos 7 dias</SelectItem>
            <SelectItem value="720">Últimos 30 dias</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo o histórico</SelectItem>
            <SelectItem value="active">Ativos (pendente + esgotado)</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="in_flight">Em execução</SelectItem>
            <SelectItem value="exhausted">Esgotado</SelectItem>
            <SelectItem value="succeeded">Sucesso</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Métricas agregadas na janela selecionada */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
            <TrendingUp className="h-3 w-3" /> Taxa de sucesso
          </div>
          <div className="text-2xl font-bold">
            {summary.successRate.toFixed(1)}<span className="text-sm font-normal text-muted-foreground">%</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {summary.succeeded} recuperados / {summary.succeeded + summary.exhausted} finalizados
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Recuperados
          </div>
          <div className="text-2xl font-bold text-emerald-700">{summary.succeeded}</div>
          <div className="text-xs text-muted-foreground">média {summary.avgAttempts.toFixed(1)} tentativas</div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
            <AlertTriangle className="h-3 w-3 text-red-600" /> Esgotados
          </div>
          <div className="text-2xl font-bold text-red-700">{summary.exhausted}</div>
          <div className="text-xs text-muted-foreground">exigem ação manual</div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
            <Clock className="h-3 w-3 text-amber-600" /> Em andamento
          </div>
          <div className="text-2xl font-bold text-amber-700">{summary.pending}</div>
          <div className="text-xs text-muted-foreground">pendente + em execução</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-sm font-semibold mb-3">Falhas por categoria</div>
          {summary.topCategories.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem dados na janela</div>
          ) : (
            <div className="space-y-2">
              {summary.topCategories.map(([cat, total]) => {
                const pct = summary.total > 0 ? (total / summary.total) * 100 : 0;
                return (
                  <div key={cat}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-mono">{cat}</span>
                      <span className="text-muted-foreground">{total} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold mb-3">Recuperação por tipo de documento</div>
          {summary.byDocType.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem dados na janela</div>
          ) : (
            <div className="space-y-2">
              {summary.byDocType.map(([dt, agg]) => {
                const finalized = agg.succeeded + agg.exhausted;
                const rate = finalized > 0 ? (agg.succeeded / finalized) * 100 : 0;
                return (
                  <div key={dt} className="flex items-center justify-between text-xs">
                    <span className="font-mono">{dt}</span>
                    <div className="flex gap-3 text-muted-foreground">
                      <span>{agg.total} total</span>
                      <span className="text-emerald-700">{agg.succeeded} ok</span>
                      <span className="text-red-700">{agg.exhausted} falha</span>
                      <span className="font-semibold text-foreground w-12 text-right">{rate.toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {["pending", "in_flight", "exhausted", "succeeded", "cancelled"].map(s => (
          <Card key={s} className="p-3">
            <div className="text-xs text-muted-foreground uppercase">{s}</div>
            <div className="text-2xl font-bold">{counts[s] || 0}</div>
          </Card>
        ))}
      </div>


      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Selecionar todos"
                  checked={dispatchableIds.length > 0 && dispatchableIds.every((id) => selected.includes(id))}
                  onCheckedChange={toggleAll}
                  disabled={dispatchableIds.length === 0}
                />
              </TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Tentativas</TableHead>
              <TableHead>Última tentativa</TableHead>
              <TableHead>Próxima</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Último erro</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 && (
              <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                {loading ? "Carregando..." : "Nenhum registro de integração no período"}
              </TableCell></TableRow>
            )}
            {visibleRows.map(r => {
              const canDispatch = r.status === "pending" || r.status === "exhausted" || r.status === "cancelled";
              return (
              <TableRow key={r.id} data-state={selected.includes(r.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`Selecionar ${r.ref_id}`}
                    checked={selected.includes(r.id)}
                    onCheckedChange={() => toggleRow(r.id)}
                    disabled={!canDispatch}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{r.doc_type}</TableCell>
                <TableCell>{r.company_db || "-"}</TableCell>
                <TableCell className="font-mono text-xs">{r.ref_id.slice(0, 12)}…</TableCell>
                <TableCell>{r.attempts}/{r.max_attempts}</TableCell>
                <TableCell className="text-xs">{fmtDate(r.last_attempt_at)}</TableCell>
                <TableCell className="text-xs">{fmtDate(r.next_attempt_at)}</TableCell>
                <TableCell><Badge variant="outline">{r.error_category || "-"}</Badge></TableCell>
                <TableCell><Badge className={STATUS_COLORS[r.status]}>{r.status}</Badge></TableCell>
                <TableCell className="max-w-md truncate text-xs text-destructive" title={r.last_error || ""}>
                  {r.last_error || "-"}
                </TableCell>
                <TableCell className="text-right space-x-1 whitespace-nowrap">
                  {canDispatch && (
                    <Button size="sm" variant="outline" onClick={() => retryNow(r.id)}>
                      <PlayCircle className="h-3 w-3 mr-1" />Reenviar
                    </Button>
                  )}
                  {r.status !== "cancelled" && r.status !== "succeeded" && (
                    <Button size="sm" variant="ghost" onClick={() => cancel(r.id)} aria-label="Cancelar">
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );})}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
