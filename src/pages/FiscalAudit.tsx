import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, FileSearch, Loader2, AlertTriangle, Calendar, Download, Trophy } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSap } from "@/contexts/SapContext";
import { useModuleAccess } from "@/hooks/usePermissions";
import { sapQueryAll, sapQuery } from "@/lib/sap-client";
import { toast } from "sonner";

interface SapInvoice {
  DocEntry: number;
  DocNum: number;
  DocDate: string;
  DocDueDate: string | null;
  CardCode: string;
  CardName: string;
  DocTotal: number;
  DocCurrency: string;
  DocumentStatus: string; // bost_Open | bost_Close
  UserSign: number;
  CreationDate: string | null;
}

interface SapUser {
  UserCode: string;
  UserName: string;
  InternalKey: number;
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

const fmtMoney = (n: number, currency = "BRL") => {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n || 0);
  } catch {
    return `${currency} ${(n || 0).toFixed(2)}`;
  }
};

const daysBetween = (a: Date, b: Date) =>
  Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

export default function FiscalAudit() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { hasAccess, loading: permLoading } = useModuleAccess("fiscal_audit");

  // Default range: last 365 days
  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 365);
    return d;
  }, [today]);

  const [startDate, setStartDate] = useState<string>(toISODate(defaultStart));
  const [endDate, setEndDate] = useState<string>(toISODate(today));
  
  const [groupBy, setGroupBy] = useState<"day" | "month" | "quarter">("month");

  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<SapInvoice[]>([]);
  const [salesInvoices, setSalesInvoices] = useState<SapInvoice[]>([]);
  const [users, setUsers] = useState<Map<number, SapUser>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const select = "DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,DocCurrency,DocumentStatus,UserSign,CreationDate";
      const filter = `DocDate ge '${startDate}' and DocDate le '${endDate}'`;
      const invoiceParams = { $select: select, $filter: filter, $orderby: "DocDate desc" };

      const [invSettled, salesSettled, usrSettled] = await Promise.allSettled([
        sapQueryAll(session, "PurchaseInvoices", invoiceParams, false),
        sapQueryAll(session, "Invoices", invoiceParams, false),
        sapQueryAll(session, "Users", { $select: "UserCode,UserName,InternalKey" }, true),
      ]);

      if (invSettled.status === "rejected") {
        console.error("PurchaseInvoices failed:", invSettled.reason);
        throw invSettled.reason;
      }
      const purchases = (invSettled.value.data?.value as SapInvoice[]) || [];
      setInvoices(purchases);

      if (salesSettled.status === "fulfilled") {
        setSalesInvoices((salesSettled.value.data?.value as SapInvoice[]) || []);
      } else {
        console.warn("Invoices (saída) failed — continuando só com entrada:", salesSettled.reason);
        setSalesInvoices([]);
      }

      const map = new Map<number, SapUser>();
      if (usrSettled.status === "fulfilled") {
        const d: any = usrSettled.value.data;
        const usrValue: SapUser[] = Array.isArray(d) ? d : (d?.value || []);
        usrValue.forEach((u) => {
          if (u.InternalKey != null) map.set(Number(u.InternalKey), u);
        });
        console.log(`[FiscalAudit] Users carregados: ${usrValue.length}`);
      } else {
        console.warn("Users failed:", usrSettled.reason);
      }
      setUsers(map);

      if (purchases.length === 0) {
        toast.info(`Nenhuma nota de entrada entre ${startDate} e ${endDate}.`);
      }
    } catch (e: any) {
      const msg = e?.message || "Falha ao consultar notas no SAP";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyDB]);


  // === Analysis tab — todas as notas em aberto no período ===
  const oldOpen = useMemo(() => {
    return invoices
      .filter((i) => i.DocumentStatus === "bost_Open")
      .sort((a, b) => new Date(a.DocDate).getTime() - new Date(b.DocDate).getTime());
  }, [invoices]);

  const oldOpenTotalByCurrency = useMemo(() => {
    const m = new Map<string, number>();
    oldOpen.forEach((i) => {
      const c = i.DocCurrency || "BRL";
      m.set(c, (m.get(c) || 0) + (Number(i.DocTotal) || 0));
    });
    return Array.from(m.entries());
  }, [oldOpen]);

  // === Quantitative ===
  const buckets = useMemo(() => {
    const m = new Map<string, { count: number; total: number }>();
    invoices.forEach((i) => {
      const d = new Date(i.DocDate);
      let key = "";
      if (groupBy === "day") key = d.toISOString().slice(0, 10);
      else if (groupBy === "month") key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      else {
        const q = Math.floor(d.getMonth() / 3) + 1;
        key = `${d.getFullYear()}-T${q}`;
      }
      const prev = m.get(key) || { count: 0, total: 0 };
      m.set(key, { count: prev.count + 1, total: prev.total + (Number(i.DocTotal) || 0) });
    });
    const base = Array.from(m.entries())
      .map(([k, v]) => ({ period: k, count: v.count, total: v.total }))
      .sort((a, b) => a.period.localeCompare(b.period));

    // Average and linear trend (least squares on count over index)
    const n = base.length;
    const avg = n ? base.reduce((s, b) => s + b.count, 0) / n : 0;
    let slope = 0, intercept = avg;
    if (n > 1) {
      const xs = base.map((_, i) => i);
      const ys = base.map((b) => b.count);
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
      slope = den ? num / den : 0;
      intercept = my - slope * mx;
    }

    let acc = 0;
    return base.map((b, i) => {
      acc += b.count;
      return {
        ...b,
        acumulado: acc,
        media: avg,
        tendencia: intercept + slope * i,
        valor_grafico: b.count,
      };
    });
  }, [invoices, groupBy]);

  const exportQuantitativoCsv = () => {
    const header = ["Periodo", "Quantidade_Mes", "Acumulado", "Media", "Tendencia", "Valor_Grafico"];
    const rows = buckets.map((b) => [
      b.period,
      b.count,
      (b as any).acumulado,
      (b as any).media.toFixed(6),
      (b as any).tendencia.toFixed(6),
      (b as any).valor_grafico,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-fiscal-quantitativo-${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // === Per user report (entrada + saída) ===
  type UserStat = {
    userSign: number;
    userCode: string;
    userName: string;
    entrada: number;
    saida: number;
    total: number;
    valor: number;
  };

  const perUser = useMemo<UserStat[]>(() => {
    const m = new Map<number, UserStat>();
    const ensure = (sign: number): UserStat => {
      let s = m.get(sign);
      if (!s) {
        const u = users.get(sign);
        s = {
          userSign: sign,
          userCode: u?.UserCode || `#${sign}`,
          userName: u?.UserName || u?.UserCode || `#${sign}`,
          entrada: 0,
          saida: 0,
          total: 0,
          valor: 0,
        };
        m.set(sign, s);
      }
      return s;
    };
    invoices.forEach((i) => {
      const s = ensure(i.UserSign);
      s.entrada += 1;
      s.total += 1;
      s.valor += Number(i.DocTotal) || 0;
    });
    salesInvoices.forEach((i) => {
      const s = ensure(i.UserSign);
      s.saida += 1;
      s.total += 1;
      s.valor += Number(i.DocTotal) || 0;
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [invoices, salesInvoices, users]);

  const perUserTotals = useMemo(() => {
    const totalNotes = perUser.reduce((s, u) => s + u.total, 0);
    const leader = perUser[0];
    return { totalNotes, leader };
  }, [perUser]);

  const exportPerUserCsv = () => {
    const header = ["Usuario", "Nome_Usuario", "Total_Notas", "Notas_Entrada", "Notas_Saida", "Valor_Total"];
    const rows = perUser.map((u) => [
      u.userCode,
      u.userName,
      u.total,
      u.entrada,
      u.saida,
      (u.valor || 0).toFixed(2),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-fiscal-por-usuario-${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };


  if (!permLoading && !hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Sem permissão para acessar Auditoria Fiscal.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <FileSearch className="w-6 h-6 text-warning" />
                Auditoria Fiscal
              </h1>
              <p className="text-sm text-muted-foreground">
                Notas fiscais de entrada — {session?.companyDB || "—"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Filters */}
        <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <Label htmlFor="start" className="text-xs">Data inicial</Label>
            <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="end" className="text-xs">Data final</Label>
            <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Consultar SAP
          </Button>
        </div>

        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        <Tabs defaultValue="analysis" className="w-full">
          <TabsList>
            <TabsTrigger value="analysis">Análise</TabsTrigger>
            <TabsTrigger value="quantitative">Quantitativo</TabsTrigger>
            <TabsTrigger value="byuser">Por usuário</TabsTrigger>
          </TabsList>

          {/* === Análise === */}
          <TabsContent value="analysis" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="glass-card p-4">
                <div className="text-xs text-muted-foreground">Notas em aberto há mais de {threshold} dias</div>
                <div className="text-3xl font-bold text-warning mt-1">{oldOpen.length}</div>
              </div>
              <div className="glass-card p-4 md:col-span-2">
                <div className="text-xs text-muted-foreground mb-2">Valor pendente</div>
                <div className="flex flex-wrap gap-3">
                  {oldOpenTotalByCurrency.length === 0 ? (
                    <span className="text-muted-foreground text-sm">—</span>
                  ) : (
                    oldOpenTotalByCurrency.map(([c, v]) => (
                      <Badge key={c} variant="outline" className="text-sm">
                        {fmtMoney(v, c === "R$" ? "BRL" : c)}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left">DocNum</th>
                      <th className="px-4 py-3 text-left">Emissão</th>
                      <th className="px-4 py-3 text-left">Vencimento</th>
                      <th className="px-4 py-3 text-left">Fornecedor</th>
                      <th className="px-4 py-3 text-right">Valor</th>
                      <th className="px-4 py-3 text-right">Dias em aberto</th>
                      <th className="px-4 py-3 text-left">Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={7} className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                    ) : oldOpen.length === 0 ? (
                      <tr><td colSpan={7} className="text-center text-muted-foreground py-12">Nenhuma nota em aberto além de {threshold} dias 🎉</td></tr>
                    ) : oldOpen.map((i) => {
                      const days = daysBetween(new Date(i.DocDate), today);
                      const u = users.get(i.UserSign);
                      return (
                        <tr key={i.DocEntry} className="border-b border-border hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-mono">{i.DocNum}</td>
                          <td className="px-4 py-2.5">{fmtDate(i.DocDate)}</td>
                          <td className="px-4 py-2.5">{fmtDate(i.DocDueDate)}</td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium">{i.CardName}</div>
                            <div className="text-xs text-muted-foreground">{i.CardCode}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right">{fmtMoney(i.DocTotal, i.DocCurrency === "R$" ? "BRL" : i.DocCurrency)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <Badge variant="outline" className={days > 180 ? "bg-destructive/15 text-destructive border-destructive/30" : "bg-warning/15 text-warning border-warning/30"}>
                              {days} d
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{u?.UserName || u?.UserCode || `#${i.UserSign}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* === Quantitativo === */}
          <TabsContent value="quantitative" className="space-y-4">
            <div className="glass-card p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <div className="text-sm text-foreground">
                    <span className="font-semibold">{session?.companyDB}</span>: gráfico de NF(s) de entrada lançada(s) por{" "}
                    {groupBy === "day" ? "dia" : groupBy === "quarter" ? "trimestre" : "mês"} desde{" "}
                    <span className="font-semibold">{fmtDate(startDate)}</span>.
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3">
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {invoices.length} notas no período</span>
                    <span>{buckets.length} linha(s) retornada(s)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Dia</SelectItem>
                      <SelectItem value="month">Mês</SelectItem>
                      <SelectItem value="quarter">Trimestre</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={exportQuantitativoCsv} disabled={buckets.length === 0}>
                    <Download className="w-4 h-4 mr-2" /> Exportar CSV
                  </Button>
                </div>
              </div>
            </div>

            <div className="glass-card p-4 h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={buckets} margin={{ top: 10, right: 20, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="period" stroke="hsl(var(--muted-foreground))" fontSize={11} angle={-25} textAnchor="end" height={60} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    formatter={(v: any) => typeof v === "number" ? v.toFixed(2) : v}
                  />
                  <Line type="monotone" dataKey="valor_grafico" stroke="hsl(var(--primary))" strokeWidth={2.5} name="Valor_Grafico" dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="media" stroke="hsl(var(--success))" strokeWidth={1.5} strokeDasharray="5 5" name="Média" dot={false} />
                  <Line type="monotone" dataKey="tendencia" stroke="hsl(var(--warning))" strokeWidth={1.5} strokeDasharray="3 3" name="Tendência" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left">Período</th>
                      <th className="px-4 py-3 text-right">Quantidade_Mes</th>
                      <th className="px-4 py-3 text-right">Acumulado</th>
                      <th className="px-4 py-3 text-right">Media</th>
                      <th className="px-4 py-3 text-right">Tendência</th>
                      <th className="px-4 py-3 text-right">Valor_Grafico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.map((b: any) => (
                      <tr key={b.period} className="border-b border-border hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-mono">{b.period}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{b.count}</td>
                        <td className="px-4 py-2.5 text-right">{b.acumulado}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{b.media.toFixed(6)}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{b.tendencia.toFixed(6)}</td>
                        <td className="px-4 py-2.5 text-right text-primary">{b.valor_grafico}</td>
                      </tr>
                    ))}
                    {buckets.length === 0 && (
                      <tr><td colSpan={6} className="text-center text-muted-foreground py-8">Sem dados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>


          {/* === Por usuário === */}
          <TabsContent value="byuser" className="space-y-4">
            <div className="glass-card p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1">
                  <div className="text-sm text-foreground">
                    <span className="font-semibold">{session?.companyDB}</span>: ranking dos usuários que mais lançaram notas no período. Total:{" "}
                    <span className="font-semibold text-primary">{perUserTotals.totalNotes}</span> nota(s).
                  </div>
                  {perUserTotals.leader && (
                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                      <Trophy className="w-4 h-4 text-warning" />
                      Líder: <span className="font-semibold text-foreground">{perUserTotals.leader.userName}</span> com{" "}
                      <span className="font-semibold text-foreground">{perUserTotals.leader.total}</span> nota(s).
                    </div>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={exportPerUserCsv} disabled={perUser.length === 0}>
                  <Download className="w-4 h-4 mr-2" /> Exportar CSV
                </Button>
              </div>
            </div>

            <div className="glass-card p-4">
              <div className="text-xs text-muted-foreground mb-2">{perUser.length} linha(s) retornada(s)</div>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={perUser.slice(0, 25)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="userCode" stroke="hsl(var(--muted-foreground))" fontSize={11} angle={-25} textAnchor="end" height={60} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <RTooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    />
                    <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} name="Total_Notas" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left">Usuario</th>
                      <th className="px-4 py-3 text-left">Nome_Usuario</th>
                      <th className="px-4 py-3 text-right">Total_Notas</th>
                      <th className="px-4 py-3 text-right">Notas_Entrada</th>
                      <th className="px-4 py-3 text-right">Notas_Saida</th>
                      <th className="px-4 py-3 text-right">Valor_Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perUser.map((u) => (
                      <tr key={u.userSign} className="border-b border-border hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-mono text-xs">{u.userCode}</td>
                        <td className="px-4 py-2.5 font-medium">{u.userName}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{u.total}</td>
                        <td className="px-4 py-2.5 text-right text-success">{u.entrada}</td>
                        <td className="px-4 py-2.5 text-right text-primary">{u.saida}</td>
                        <td className="px-4 py-2.5 text-right">{fmtMoney(u.valor)}</td>
                      </tr>
                    ))}
                    {perUser.length === 0 && (
                      <tr><td colSpan={6} className="text-center text-muted-foreground py-8">Sem dados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
