import { useState, useMemo, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { UserCheck, DollarSign, PieChart as PieIcon, Building2, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeriodFilter, DEFAULT_PERIOD, type PeriodFilterValue } from "@/components/PeriodFilter";
import { useSap } from "@/contexts/SapContext";
import { useApprovals } from "@/hooks/useApprovals";
import { supabase } from "@/integrations/supabase/client";

type Origem = "all" | "sap" | "sistema";

interface PendingItem {
  origem: "sap" | "sistema";
  docType: string;
  docNum: string;
  supplierName: string;
  supplierCode: string;
  requester: string;
  approver: string;
  total: number;
  currency: string;
  date: string; // ISO
}

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--warning))",
  "hsl(var(--success))",
  "hsl(var(--destructive))",
  "hsl(220 70% 55%)",
  "hsl(280 65% 60%)",
  "hsl(30 90% 55%)",
  "hsl(160 60% 45%)",
  "hsl(340 75% 55%)",
  "hsl(200 80% 50%)",
];

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtCompact(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}mi`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}

export function PendingApprovalsReport() {
  const { session } = useSap();
  const { approvals, isLoading: sapLoading, refresh: refreshSap } = useApprovals();
  const [systemItems, setSystemItems] = useState<PendingItem[]>([]);
  const [sysLoading, setSysLoading] = useState(true);

  const [origem, setOrigem] = useState<Origem>("all");
  const [period, setPeriod] = useState<PeriodFilterValue>(DEFAULT_PERIOD);
  const [search, setSearch] = useState("");

  // Load system pending (expenses + advance_payments)
  const loadSystem = async () => {
    if (!session?.companyDB) return;
    setSysLoading(true);
    try {
      const [{ data: exp }, { data: adv }] = await Promise.all([
        supabase
          .from("expenses")
          .select("id,supplier_code,supplier_name,total_amount,currency,requester_name,current_approver,doc_type,sap_doc_num,doc_date,created_at")
          .eq("company_db", session.companyDB)
          .eq("status", "pendente_aprovacao"),
        supabase
          .from("advance_payments")
          .select("id,supplier_card_code,supplier_name,amount,currency,requester_name,created_at")
          .eq("company_db", session.companyDB)
          .eq("status", "pendente_aprovacao"),
      ]);

      const items: PendingItem[] = [];
      for (const e of exp || []) {
        items.push({
          origem: "sistema",
          docType: (e.doc_type as string) || "expense",
          docNum: e.sap_doc_num ? String(e.sap_doc_num) : String(e.id).slice(0, 8),
          supplierName: e.supplier_name || "—",
          supplierCode: e.supplier_code || "",
          requester: e.requester_name || "—",
          approver: e.current_approver || "—",
          total: Number(e.total_amount || 0),
          currency: e.currency || "BRL",
          date: (e.doc_date || e.created_at) as string,
        });
      }
      for (const a of adv || []) {
        items.push({
          origem: "sistema",
          docType: "advance",
          docNum: String(a.id).slice(0, 8),
          supplierName: a.supplier_name || "—",
          supplierCode: a.supplier_card_code || "",
          requester: a.requester_name || "—",
          approver: "—",
          total: Number(a.amount || 0),
          currency: a.currency || "BRL",
          date: a.created_at as string,
        });
      }
      setSystemItems(items);
    } catch (e) {
      console.error("Erro carregando pendências do sistema:", e);
      setSystemItems([]);
    } finally {
      setSysLoading(false);
    }
  };

  useEffect(() => {
    loadSystem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyDB]);

  const sapItems: PendingItem[] = useMemo(
    () =>
      (approvals || [])
        .filter((a) => a.status === "pending")
        .map((a) => ({
          origem: "sap" as const,
          docType: a.docTypeName || a.docType,
          docNum: String(a.docNum),
          supplierName: a.cardName || "—",
          supplierCode: a.cardCode || "",
          requester: a.requester || "—",
          approver: a.currentApprover || "—",
          total: Number(a.docTotal || 0),
          currency: a.currency || "BRL",
          date: a.docDate,
        })),
    [approvals]
  );

  const filtered = useMemo(() => {
    const all = [...sapItems, ...systemItems];
    const q = search.trim().toLowerCase();
    const fromTs = period.range.from?.getTime();
    const toTs = period.range.to?.getTime();
    return all.filter((it) => {
      if (origem !== "all" && it.origem !== origem) return false;
      if (fromTs !== undefined && toTs !== undefined) {
        const t = new Date(it.date).getTime();
        if (isNaN(t) || t < fromTs || t > toTs) return false;
      }
      if (q) {
        const hay = `${it.supplierName} ${it.supplierCode} ${it.requester} ${it.approver}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sapItems, systemItems, origem, period, search]);

  // Aggregations
  const byApprover = useMemo(() => {
    const m = new Map<string, { count: number; sum: number }>();
    for (const it of filtered) {
      const key = it.approver || "—";
      const cur = m.get(key) || { count: 0, sum: 0 };
      cur.count += 1;
      cur.sum += it.total;
      m.set(key, cur);
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, count: v.count, sum: v.sum }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [filtered]);

  const byApproverSum = useMemo(
    () => [...byApprover].sort((a, b) => b.sum - a.sum),
    [byApprover]
  );

  const bySupplier = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of filtered) {
      m.set(it.supplierName, (m.get(it.supplierName) || 0) + it.total);
    }
    const arr = Array.from(m.entries()).map(([name, value]) => ({ name, value }));
    arr.sort((a, b) => b.value - a.value);
    const top = arr.slice(0, 9);
    const rest = arr.slice(9);
    if (rest.length) {
      const outros = rest.reduce((s, r) => s + r.value, 0);
      top.push({ name: "Outros", value: outros });
    }
    return top;
  }, [filtered]);

  const topSuppliers = useMemo(() => {
    const m = new Map<string, { count: number; total: number }>();
    for (const it of filtered) {
      const cur = m.get(it.supplierName) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += it.total;
      m.set(it.supplierName, cur);
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [filtered]);

  const totalCount = filtered.length;
  const totalSum = filtered.reduce((s, it) => s + it.total, 0);
  const isLoading = sapLoading || sysLoading;

  const refresh = () => {
    refreshSap();
    loadSystem();
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Filters */}
      <div className="glass-card p-3 sm:p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
        <PeriodFilter value={period} onChange={setPeriod} />
        <Select value={origem} onValueChange={(v) => setOrigem(v as Origem)}>
          <SelectTrigger className="w-full lg:w-[180px]">
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as origens</SelectItem>
            <SelectItem value="sap">SAP B1</SelectItem>
            <SelectItem value="sistema">Sistema (Interno)</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar fornecedor, solicitante ou aprovador…"
            className="pl-9"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {isLoading && filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Carregando aprovações pendentes…</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Documentos em Aprovação</p>
              <p className="text-2xl font-bold text-foreground mt-1">{totalCount}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Valor Total</p>
              <p className="text-2xl font-bold text-foreground mt-1">{fmtBRL(totalSum)}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Aprovadores Envolvidos</p>
              <p className="text-2xl font-bold text-foreground mt-1">{byApprover.length}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Fornecedores</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {new Set(filtered.map((f) => f.supplierName)).size}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* QTD por Aprovador */}
            <div className="glass-card p-3 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <UserCheck className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">QTD Documentos em Aprovação</h2>
                <span className="text-xs text-muted-foreground ml-auto">Por Aprovador</span>
              </div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byApprover} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                    <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [v, "Documentos"]}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* SUM por Aprovador */}
            <div className="glass-card p-3 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">SUM Documentos em Aprovação</h2>
                <span className="text-xs text-muted-foreground ml-auto">Por Aprovador</span>
              </div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byApproverSum} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} horizontal={false} />
                    <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtCompact} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [fmtBRL(v), "Valor"]}
                    />
                    <Bar dataKey="sum" fill="hsl(var(--warning))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Distribuição por Fornecedor */}
            <div className="glass-card p-3 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <PieIcon className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Distribuição de Custos</h2>
                <span className="text-xs text-muted-foreground ml-auto">Por Fornecedor</span>
              </div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={bySupplier}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      innerRadius={40}
                      paddingAngle={2}
                    >
                      {bySupplier.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number, n: string) => [fmtBRL(v), n]}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top Fornecedores */}
            <div className="glass-card p-3 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Fornecedores</h2>
                <span className="text-xs text-muted-foreground ml-auto">Total em aprovação</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2">Fornecedor</th>
                      <th className="py-2 text-right">Qtd</th>
                      <th className="py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSuppliers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center py-6 text-muted-foreground text-xs">
                          Sem dados no filtro atual
                        </td>
                      </tr>
                    )}
                    {topSuppliers.map((s) => (
                      <tr key={s.name} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 pr-2 truncate max-w-[240px]" title={s.name}>{s.name}</td>
                        <td className="py-2 text-right text-muted-foreground">{s.count}</td>
                        <td className="py-2 text-right font-medium">{fmtBRL(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
