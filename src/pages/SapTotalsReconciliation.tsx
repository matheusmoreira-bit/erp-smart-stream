import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { expenseRead } from "@/lib/expense-read";
import { invokeFn } from "@/lib/invoke-fn";
import { useCompanies } from "@/hooks/useCompanies";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Info, Loader2, Play, RefreshCw, Scale } from "lucide-react";
import { toast } from "sonner";

interface ReconRow {
  id: string;
  expense_id: string;
  company_db: string;
  doc_type: string | null;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
  flow_total: number;
  sap_total: number;
  sap_net_total: number;
  difference: number;
  abs_difference: number;
  status: string;
  cause: string | null;
  cause_label: string | null;
  cause_detail: Record<string, unknown> | null;
  breakdown: Record<string, unknown> | null;
  checked_at: string;
}

type StatusFilter = "all" | "divergent" | "explained" | "ok" | "error";

const STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ok: { label: "Conferido", variant: "secondary" },
  explained: { label: "Explicado", variant: "outline" },
  divergent: { label: "Divergente", variant: "destructive" },
  error: { label: "Erro na leitura", variant: "destructive" },
};

const money = (v: number, currency = "BRL") =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency });

function explain(row: ReconRow): string {
  const detail = row.cause_detail || {};
  const txt = typeof detail.explicacao === "string" ? detail.explicacao : "";
  if (txt) return txt;
  if (typeof detail.erro === "string") return detail.erro;
  if (row.status === "ok") return "Total do ERP Flow idêntico ao total do SAP.";
  return row.cause_label || "—";
}

export default function SapTotalsReconciliation() {
  const { companies } = useCompanies();
  const [companyDb, setCompanyDb] = useState<string>("");
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [days, setDays] = useState("90");

  useEffect(() => {
    if (!companyDb && companies.length) setCompanyDb(companies[0].company_db);
  }, [companies, companyDb]);

  const load = useCallback(async () => {
    if (!companyDb) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("sap_total_reconciliation")
      .select("*")
      .eq("company_db", companyDb)
      .order("abs_difference", { ascending: false })
      .limit(300);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const list = (data || []) as unknown as ReconRow[];
    setRows(list);

    const ids = list.map((r) => r.expense_id);
    if (ids.length) {
      const { data: exps } = await expenseRead("expenses")
        .viewAll()
        .select("id, supplier_name")
        .in("id", ids)
        .limit(300);
      const map: Record<string, string> = {};
      for (const e of exps || []) map[e.id] = e.supplier_name || "—";
      setNames(map);
    }
    setLoading(false);
  }, [companyDb]);

  useEffect(() => {
    void load();
  }, [load]);

  const runReconcile = async () => {
    if (!companyDb) return;
    setRunning(true);
    const { data, error } = await invokeFn<{
      checked?: number;
      divergent?: number;
      explained?: number;
      error?: string;
    }>("expense-sap-reconcile", {
      body: { company_db: companyDb, days: Number(days) || 90, limit: 200 },
    });
    setRunning(false);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Falha ao reconciliar");
      return;
    }
    toast.success(
      `${data?.checked ?? 0} documento(s) conferidos — ${data?.divergent ?? 0} divergência(s), ${data?.explained ?? 0} explicada(s).`,
    );
    void load();
  };

  const kpis = useMemo(() => {
    const by = (s: string) => rows.filter((r) => r.status === s).length;
    const impact = rows
      .filter((r) => r.status === "divergent")
      .reduce((s, r) => s + Math.abs(Number(r.difference || 0)), 0);
    return { total: rows.length, ok: by("ok"), explained: by("explained"), divergent: by("divergent"), errors: by("error"), impact };
  }, [rows]);

  const filtered = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter],
  );

  const causeSummary = useMemo(() => {
    const map = new Map<string, { label: string; count: number; total: number }>();
    for (const r of rows) {
      if (!r.cause) continue;
      const cur = map.get(r.cause) || { label: r.cause_label || r.cause, count: 0, total: 0 };
      cur.count += 1;
      cur.total += Math.abs(Number(r.difference || 0));
      map.set(r.cause, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageTitle title="Reconciliação de totais ERP Flow × SAP" />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <Label className="text-xs text-muted-foreground">Empresa</Label>
          <Select value={companyDb} onValueChange={setCompanyDb}>
            <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.company_db} value={c.company_db}>{c.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[160px]">
          <Label className="text-xs text-muted-foreground">Período</Label>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="180">Últimos 180 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[190px]">
          <Label className="text-xs text-muted-foreground">Situação</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="divergent">Divergentes</SelectItem>
              <SelectItem value="explained">Explicadas</SelectItem>
              <SelectItem value="ok">Conferidas</SelectItem>
              <SelectItem value="error">Erros</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={runReconcile} disabled={running || !companyDb}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Reconciliar agora
        </Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Documentos conferidos", value: String(kpis.total), icon: Scale },
          { label: "Sem divergência", value: String(kpis.ok), icon: CheckCircle2 },
          { label: "Divergência explicada", value: String(kpis.explained), icon: Info },
          { label: "Divergentes", value: String(kpis.divergent), icon: AlertTriangle },
          { label: "Impacto financeiro", value: money(kpis.impact), icon: AlertTriangle },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <k.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-lg font-semibold">{k.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {causeSummary.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Causas apontadas</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {causeSummary.map((c) => (
              <Badge key={c.label} variant="outline" className="gap-2 py-1">
                {c.label}
                <span className="font-semibold">{c.count}</span>
                {c.total > 0 && <span className="text-muted-foreground">{money(c.total)}</span>}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Nenhum resultado</AlertTitle>
          <AlertDescription>
            Rode a reconciliação para comparar os totais dos documentos integrados desta empresa com o SAP.
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Parceiro</TableHead>
                  <TableHead className="text-right">Total Flow</TableHead>
                  <TableHead className="text-right">Total SAP</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Causa apontada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const meta = STATUS_META[r.status] ?? { label: r.status, variant: "outline" as const };
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        <div className="font-medium">{r.sap_doc_num ? `#${r.sap_doc_num}` : "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.doc_type === "sales" ? "Pedido de venda" : "Pedido de compra"}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate">{names[r.expense_id] || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(Number(r.flow_total))}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(Number(r.sap_total))}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${Math.abs(Number(r.difference)) > 0.02 ? "font-semibold text-destructive" : ""}`}
                      >
                        {money(Number(r.difference))}
                      </TableCell>
                      <TableCell><Badge variant={meta.variant}>{meta.label}</Badge></TableCell>
                      <TableCell className="max-w-[380px] text-sm text-muted-foreground">{explain(r)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
