import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, FileSearch, Loader2, AlertTriangle, Calendar, Download, Trophy, Database, Layers } from "lucide-react";
import {
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSap } from "@/contexts/SapContext";
import { useModuleAccess } from "@/hooks/usePermissions";
import { useCompanies } from "@/hooks/useCompanies";
import { sapQueryAll } from "@/lib/sap-client";
import { supabase } from "@/integrations/supabase/client";
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
  DocumentStatus: string;
  Cancelled?: string;
  UserSign: number;
  CreationDate: string | null;
  _companyDB?: string;
}

interface SapUser {
  UserCode: string;
  UserName: string;
  InternalKey: number;
  _companyDB?: string;
}

interface FiscalCachePayload {
  fetchStart: string;
  fetchEnd: string;
  invoices: SapInvoice[];
  salesInvoices: SapInvoice[];
  users: SapUser[];
  fetchedAt: string;
}

const CACHE_KEY = "fiscal_audit_invoices";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR") : "—";

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

const isCancelled = (i: SapInvoice) => {
  const c = (i.Cancelled || "").toString().toLowerCase();
  return c === "tyes" || c === "y" || c === "yes" || c === "true";
};

export default function FiscalAudit() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { hasAccess, loading: permLoading } = useModuleAccess("fiscal_audit");
  const { companies } = useCompanies(true);

  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 365);
    return d;
  }, [today]);

  const [startDate, setStartDate] = useState<string>(toISODate(defaultStart));
  const [endDate, setEndDate] = useState<string>(toISODate(today));
  const [groupBy, setGroupBy] = useState<"day" | "month" | "quarter">("month");

  // Novos filtros
  const [consolidated, setConsolidated] = useState(false);
  const [docType, setDocType] = useState<"all" | "entrada" | "saida">("all");
  const [cancelStatus, setCancelStatus] = useState<"all" | "active" | "cancelled">("active");

  const [loading, setLoading] = useState(false);
  const [allInvoices, setAllInvoices] = useState<SapInvoice[]>([]);
  const [allSalesInvoices, setAllSalesInvoices] = useState<SapInvoice[]>([]);
  const [users, setUsers] = useState<Map<string, SapUser>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ fetchedAt: string; fetchStart: string; fetchEnd: string; sources?: number } | null>(null);

  const userKey = (companyDB: string | undefined, sign: number) =>
    `${companyDB || session?.companyDB || "?"}::${sign}`;

  // Aplica payload (single-company)
  const applyPayload = (p: FiscalCachePayload, companyDB?: string) => {
    const tagged = (arr: SapInvoice[]) => (arr || []).map((i) => ({ ...i, _companyDB: companyDB }));
    setAllInvoices(tagged(p.invoices));
    setAllSalesInvoices(tagged(p.salesInvoices));
    const map = new Map<string, SapUser>();
    (p.users || []).forEach((u) => {
      if (u.InternalKey != null) map.set(userKey(companyDB, Number(u.InternalKey)), { ...u, _companyDB: companyDB });
    });
    setUsers(map);
    setCacheInfo({ fetchedAt: p.fetchedAt, fetchStart: p.fetchStart, fetchEnd: p.fetchEnd });
    if (p.fetchStart > startDate) setStartDate(p.fetchStart);
    if (p.fetchEnd < endDate) setEndDate(p.fetchEnd);
  };

  // Carrega do cache (single)
  const loadFromCache = async (companyDB: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from("sap_cache")
      .select("data, updated_at, expires_at")
      .eq("cache_key", CACHE_KEY)
      .eq("company_db", companyDB)
      .maybeSingle();
    if (error) {
      console.warn("[FiscalAudit] cache read error:", error.message);
      return false;
    }
    if (!data?.data) return false;
    applyPayload(data.data as unknown as FiscalCachePayload, companyDB);
    return true;
  };

  // Carrega consolidado (todas as empresas)
  const loadConsolidated = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sap_cache")
        .select("company_db, data, updated_at")
        .eq("cache_key", CACHE_KEY);
      if (error) throw error;

      const allInv: SapInvoice[] = [];
      const allSal: SapInvoice[] = [];
      const usersMap = new Map<string, SapUser>();
      let minStart = "9999-99-99";
      let maxEnd = "0000-00-00";
      let latest = "";
      let sources = 0;

      (data || []).forEach((row: any) => {
        const p = row.data as FiscalCachePayload | null;
        if (!p) return;
        const cdb = row.company_db as string;
        // Ignora bases de teste (prefixo TST) no consolidado
        if (cdb && cdb.toUpperCase().startsWith("TST")) return;
        sources++;
        (p.invoices || []).forEach((i) => allInv.push({ ...i, _companyDB: cdb }));
        (p.salesInvoices || []).forEach((i) => allSal.push({ ...i, _companyDB: cdb }));
        (p.users || []).forEach((u) => {
          if (u.InternalKey != null) usersMap.set(userKey(cdb, Number(u.InternalKey)), { ...u, _companyDB: cdb });
        });
        if (p.fetchStart && p.fetchStart < minStart) minStart = p.fetchStart;
        if (p.fetchEnd && p.fetchEnd > maxEnd) maxEnd = p.fetchEnd;
        if (!latest || (p.fetchedAt && p.fetchedAt > latest)) latest = p.fetchedAt;
      });

      setAllInvoices(allInv);
      setAllSalesInvoices(allSal);
      setUsers(usersMap);
      if (sources === 0) {
        setCacheInfo(null);
        toast.info("Nenhum cache encontrado. Atualize cada empresa do SAP primeiro.");
      } else {
        setCacheInfo({ fetchedAt: latest, fetchStart: minStart, fetchEnd: maxEnd, sources });
      }
    } catch (e: any) {
      const msg = e?.message || "Falha ao carregar consolidado";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Atualiza do SAP (single)
  const refreshFromSap = async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const fetchStart = cacheInfo?.fetchStart && cacheInfo.fetchStart < startDate ? cacheInfo.fetchStart : startDate;
      const fetchEnd = cacheInfo?.fetchEnd && cacheInfo.fetchEnd > endDate ? cacheInfo.fetchEnd : endDate;

      const select = "DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,DocCurrency,DocumentStatus,Cancelled,UserSign,CreationDate";
      const filter = `DocDate ge '${fetchStart}' and DocDate le '${fetchEnd}'`;
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
      const sales = salesSettled.status === "fulfilled"
        ? ((salesSettled.value.data?.value as SapInvoice[]) || [])
        : [];
      let usrValue: SapUser[] = [];
      if (usrSettled.status === "fulfilled") {
        const d: any = usrSettled.value.data;
        usrValue = Array.isArray(d) ? d : (d?.value || []);
      }

      const payload: FiscalCachePayload = {
        fetchStart,
        fetchEnd,
        invoices: purchases,
        salesInvoices: sales,
        users: usrValue,
        fetchedAt: new Date().toISOString(),
      };

      applyPayload(payload, session.companyDB);

      const { error: upErr } = await supabase
        .from("sap_cache")
        .upsert(
          {
            cache_key: CACHE_KEY,
            company_db: session.companyDB,
            data: payload as any,
            expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
          },
          { onConflict: "cache_key,company_db" },
        );
      if (upErr) console.warn("[FiscalAudit] cache write error:", upErr.message);

      if (purchases.length === 0 && sales.length === 0) {
        toast.info(`Nenhuma nota entre ${fetchStart} e ${fetchEnd}.`);
      } else {
        toast.success(`${purchases.length} entrada(s) e ${sales.length} saída(s) carregadas e salvas no cache.`);
      }
    } catch (e: any) {
      const msg = e?.message || "Falha ao consultar notas no SAP";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Inicial
  useEffect(() => {
    (async () => {
      if (consolidated) {
        await loadConsolidated();
        return;
      }
      if (!session?.companyDB) return;
      const hit = await loadFromCache(session.companyDB);
      if (!hit) await refreshFromSap();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyDB, consolidated]);

  // === Filtros client-side ===
  const passCancel = (i: SapInvoice) => {
    if (cancelStatus === "all") return true;
    const c = isCancelled(i);
    return cancelStatus === "cancelled" ? c : !c;
  };

  const invoices = useMemo(() => {
    return allInvoices.filter((i) => i.DocDate >= startDate && i.DocDate <= endDate && passCancel(i));
  }, [allInvoices, startDate, endDate, cancelStatus]);

  const salesInvoices = useMemo(() => {
    return allSalesInvoices.filter((i) => i.DocDate >= startDate && i.DocDate <= endDate && passCancel(i));
  }, [allSalesInvoices, startDate, endDate, cancelStatus]);

  // Conjunto unificado conforme tipo de NF
  const docList = useMemo(() => {
    if (docType === "entrada") return invoices;
    if (docType === "saida") return salesInvoices;
    return [...invoices, ...salesInvoices];
  }, [invoices, salesInvoices, docType]);

  // === Análise — notas em aberto no período ===
  const oldOpen = useMemo(() => {
    return docList
      .filter((i) => i.DocumentStatus === "bost_Open")
      .sort((a, b) => new Date(a.DocDate).getTime() - new Date(b.DocDate).getTime());
  }, [docList]);

  const oldOpenTotalByCurrency = useMemo(() => {
    const m = new Map<string, number>();
    oldOpen.forEach((i) => {
      const c = i.DocCurrency || "BRL";
      m.set(c, (m.get(c) || 0) + (Number(i.DocTotal) || 0));
    });
    return Array.from(m.entries());
  }, [oldOpen]);

  // === Quantitativo ===
  const buckets = useMemo(() => {
    const m = new Map<string, { count: number; total: number }>();
    docList.forEach((i) => {
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
  }, [docList, groupBy]);

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

  // === Por usuário ===
  type UserStat = {
    userKey: string;
    userCode: string;
    userName: string;
    entrada: number;
    saida: number;
    total: number;
    valor: number;
  };

  const perUser = useMemo<UserStat[]>(() => {
    const m = new Map<string, UserStat>();
    const ensure = (i: SapInvoice): UserStat => {
      const k = userKey(i._companyDB, i.UserSign);
      let s = m.get(k);
      if (!s) {
        const u = users.get(k);
        s = {
          userKey: k,
          userCode: u?.UserCode || `#${i.UserSign}`,
          userName: u?.UserName || u?.UserCode || `#${i.UserSign}`,
          entrada: 0, saida: 0, total: 0, valor: 0,
        };
        m.set(k, s);
      }
      return s;
    };
    const includeEntrada = docType !== "saida";
    const includeSaida = docType !== "entrada";
    if (includeEntrada) {
      invoices.forEach((i) => {
        const s = ensure(i);
        s.entrada += 1; s.total += 1; s.valor += Number(i.DocTotal) || 0;
      });
    }
    if (includeSaida) {
      salesInvoices.forEach((i) => {
        const s = ensure(i);
        s.saida += 1; s.total += 1; s.valor += Number(i.DocTotal) || 0;
      });
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [invoices, salesInvoices, users, docType]);

  const perUserTotals = useMemo(() => {
    const totalNotes = perUser.reduce((s, u) => s + u.total, 0);
    const leader = perUser[0];
    return { totalNotes, leader };
  }, [perUser]);

  const exportPerUserCsv = () => {
    const header = ["Usuario", "Nome_Usuario", "Total_Notas", "Notas_Entrada", "Notas_Saida", "Valor_Total"];
    const rows = perUser.map((u) => [
      u.userCode, u.userName, u.total, u.entrada, u.saida, (u.valor || 0).toFixed(2),
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

  const scopeLabel = consolidated
    ? `Consolidado (${cacheInfo?.sources ?? 0} empresa${(cacheInfo?.sources ?? 0) === 1 ? "" : "s"})`
    : (session?.companyDB || "—");

  const docTypeLabel = docType === "entrada" ? "NF de Entrada" : docType === "saida" ? "NF de Saída" : "NF Entrada + Saída";

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
                {docTypeLabel} — {scopeLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={refreshFromSap} disabled={loading || !session || consolidated}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Atualizar do SAP
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Filters */}
        <div className="glass-card p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
          <div>
            <Label htmlFor="start" className="text-xs">Data inicial</Label>
            <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="end" className="text-xs">Data final</Label>
            <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Tipo de NF</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="entrada">NF de Entrada</SelectItem>
                <SelectItem value="saida">NF de Saída</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Cancelamento</Label>
            <Select value={cancelStatus} onValueChange={(v) => setCancelStatus(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="active">Não canceladas</SelectItem>
                <SelectItem value="cancelled">Canceladas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="consolidated" checked={consolidated} onCheckedChange={setConsolidated} />
            <Label htmlFor="consolidated" className="text-xs flex items-center gap-1 cursor-pointer">
              <Layers className="w-3.5 h-3.5" /> Consolidado
            </Label>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Database className="w-3.5 h-3.5" />
            {cacheInfo ? (
              <span className="leading-tight">
                {fmtDateTime(cacheInfo.fetchedAt)}
                <br />
                {cacheInfo.fetchStart} → {cacheInfo.fetchEnd}
                {consolidated && cacheInfo.sources ? ` · ${cacheInfo.sources} empresas` : ""}
              </span>
            ) : (
              <span>Sem cache local</span>
            )}
          </div>
        </div>

        {consolidated && companies.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Empresas disponíveis: {companies.map((c) => c.display_name).join(", ")}
          </div>
        )}

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
                <div className="text-xs text-muted-foreground">Notas em aberto no período</div>
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
                      <th className="px-4 py-3 text-left">Parceiro</th>
                      <th className="px-4 py-3 text-right">Valor</th>
                      <th className="px-4 py-3 text-right">Dias em aberto</th>
                      <th className="px-4 py-3 text-left">Usuário</th>
                      {consolidated && <th className="px-4 py-3 text-left">Empresa</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={consolidated ? 8 : 7} className="text-center py-12"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                    ) : oldOpen.length === 0 ? (
                      <tr><td colSpan={consolidated ? 8 : 7} className="text-center text-muted-foreground py-12">Nenhuma nota em aberto no período 🎉</td></tr>
                    ) : oldOpen.map((i) => {
                      const days = daysBetween(new Date(i.DocDate), today);
                      const u = users.get(userKey(i._companyDB, i.UserSign));
                      return (
                        <tr key={`${i._companyDB}-${i.DocEntry}`} className="border-b border-border hover:bg-muted/20">
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
                          {consolidated && <td className="px-4 py-2.5 text-xs text-muted-foreground">{i._companyDB}</td>}
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
                    <span className="font-semibold">{scopeLabel}</span>: gráfico de {docTypeLabel.toLowerCase()} por{" "}
                    {groupBy === "day" ? "dia" : groupBy === "quarter" ? "trimestre" : "mês"} desde{" "}
                    <span className="font-semibold">{fmtDate(startDate)}</span>.
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3">
                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {docList.length} notas no período</span>
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
                    <span className="font-semibold">{scopeLabel}</span>: ranking de usuários ({docTypeLabel.toLowerCase()}) no período. Total:{" "}
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
                      <tr key={u.userKey} className="border-b border-border hover:bg-muted/20">
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
