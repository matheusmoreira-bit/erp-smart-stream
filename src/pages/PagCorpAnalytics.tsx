import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BarChart3, Loader2, RefreshCw, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ThemeToggle } from "@/components/ThemeToggle";
import { PageTitle } from "@/components/PageTitle";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { usePagCorp } from "@/hooks/usePagCorp";
import { isTreasury, usePagCorpAccounts, type PagCorpAccountInfo } from "@/hooks/usePagCorpAccounts";

const ALL = "__all__";

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function firstDayOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function PagCorpAnalytics() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { getLabel } = useCompanies(true);
  const companyDb = session?.companyDB;

  const [startDate, setStartDate] = useState(firstDayOfMonth);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [card, setCard] = useState<string>(ALL);
  const [holder, setHolder] = useState<string>(ALL);
  const [costCenter, setCostCenter] = useState<string>(ALL);
  const [accountSearch, setAccountSearch] = useState("");
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(() => new Set());

  const toggleAccount = (key: string) =>
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { transactions, isLoading: loadingTx, fetchTransactions } = usePagCorp();
  const {
    accounts,
    snapshots,
    loading: loadingAccounts,
    notConfigured,
    error: accountsError,
    capturedAt,
    reload,
  } = usePagCorpAccounts(companyDb);

  useEffect(() => {
    if (!companyDb) return;
    void fetchTransactions(startDate, endDate, companyDb);
  }, [companyDb, startDate, endDate, fetchTransactions]);

  const costCentersByAccount = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a) => {
      if (a.costCenter) map.set(a.account, a.costCenter);
    });
    return map;
  }, [accounts]);

  const cardOptions = useMemo(() => {
    const map = new Map<string, string>();
    const put = (value?: string | number | null, name?: string | null) => {
      const v = value == null ? "" : String(value).trim();
      if (!v) return;
      const n = (name || "").trim();
      const label = n && n !== v ? `${n} · ${v}` : v;
      const prev = map.get(v);
      if (!prev || prev === v) map.set(v, label);
    };
    transactions.forEach((t) => {
      put(
        t.cardName || t.cardLastDigits || t.cardId,
        (t.accountAlias || t.accountName) as string | undefined,
      );
    });
    accounts.forEach((a) => a.cards.forEach((c) => put(c.alias, a.alias)));
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [transactions, accounts]);


  const holderOptions = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => {
      const label = t.accountAlias || t.accountName;
      if (label) set.add(String(label));
    });
    accounts.forEach((a) => a.alias && !isTreasury(a) && set.add(a.alias));
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [transactions, accounts]);

  const costCenterOptions = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((a) => a.costCenter && set.add(a.costCenter));
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [accounts]);

  /** Contas em árvore (tesouraria pai → tesourarias/cartões filhos). */
  const accountTree = useMemo(() => {
    const byAccount = new Map(accounts.map((a) => [String(a.account), a]));
    const children = new Map<string, PagCorpAccountInfo[]>();
    const roots: PagCorpAccountInfo[] = [];
    accounts.forEach((a) => {
      const parent = a.parentAccount ? String(a.parentAccount) : "";
      if (parent && byAccount.has(parent) && parent !== String(a.account)) {
        const list = children.get(parent) ?? [];
        list.push(a);
        children.set(parent, list);
      } else {
        roots.push(a);
      }
    });
    const sortFn = (a: PagCorpAccountInfo, b: PagCorpAccountInfo) => {
      const ta = isTreasury(a) ? 0 : 1;
      const tb = isTreasury(b) ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return String(a.alias || a.account).localeCompare(String(b.alias || b.account), "pt-BR");
    };
    const rows: {
      account: PagCorpAccountInfo;
      depth: number;
      subtotal: number;
      hasChildren: boolean;
      ancestors: string[];
    }[] = [];
    const seen = new Set<string>();
    const walk = (node: PagCorpAccountInfo, depth: number, ancestors: string[]): number => {
      const key = String(node.account);
      if (seen.has(key)) return 0;
      seen.add(key);
      const row = { account: node, depth, subtotal: 0, hasChildren: false, ancestors };
      rows.push(row);
      const kids = (children.get(key) ?? []).sort(sortFn);
      row.hasChildren = kids.length > 0;
      let total = Number(node.available ?? 0);
      kids.forEach((k) => { total += walk(k, depth + 1, [...ancestors, key]); });
      row.subtotal = total;
      return total;
    };
    roots.sort(sortFn).forEach((r) => walk(r, 0, []));
    return rows;
  }, [accounts]);

  /** Linhas realmente exibidas: colapsadas por padrão, expandindo o que casa com a busca. */
  const visibleAccountRows = useMemo(() => {
    const term = accountSearch.trim().toLowerCase();
    if (term) {
      const matches = new Set<string>();
      accountTree.forEach((r) => {
        const a = r.account;
        const hay = `${a.alias ?? ""} ${a.account} ${a.costCenter ?? ""} ${a.cards.map((c) => c.alias ?? "").join(" ")}`.toLowerCase();
        if (hay.includes(term)) {
          matches.add(String(a.account));
          r.ancestors.forEach((p) => matches.add(p));
        }
      });
      return accountTree.filter((r) => matches.has(String(r.account.account)));
    }
    return accountTree.filter((r) => r.ancestors.every((p) => expandedAccounts.has(p)));
  }, [accountTree, accountSearch, expandedAccounts]);



  const filteredTx = useMemo(() => {
    return transactions.filter((t) => {
      if (card !== ALL) {
        const label = String(t.cardName || t.cardLastDigits || t.cardId || "");
        if (label !== card) return false;
      }
      if (holder !== ALL) {
        const label = String(t.accountAlias || t.accountName || "");
        if (label !== holder) return false;
      }
      if (costCenter !== ALL) {
        const cc = costCentersByAccount.get(String(t.accountCode || ""));
        if (cc !== costCenter) return false;
      }
      return true;
    });
  }, [transactions, card, holder, costCenter, costCentersByAccount]);

  const totals = useMemo(() => {
    let spend = 0;
    let credits = 0;
    let withdrawals = 0;
    filteredTx.forEach((t) => {
      const amount = Math.abs(Number(t.amount) || 0);
      if (t.isCredit) credits += amount;
      else {
        spend += amount;
        if (t.isWithdrawal) withdrawals += amount;
      }
    });
    return { spend, credits, withdrawals, count: filteredTx.length };
  }, [filteredTx]);

  const treasuryBalance = useMemo(
    () => accounts.filter(isTreasury).reduce((s, a) => s + (a.available ?? 0), 0),
    [accounts],
  );
  const cardsBalance = useMemo(
    () => accounts.filter((a) => !isTreasury(a)).reduce((s, a) => s + (a.available ?? 0), 0),
    [accounts],
  );

  const dailySeries = useMemo(() => {
    const map = new Map<string, { date: string; gastos: number; aportes: number }>();
    filteredTx.forEach((t) => {
      const day = String(t.date || "").slice(0, 10);
      if (!day) return;
      const row = map.get(day) ?? { date: day, gastos: 0, aportes: 0 };
      const amount = Math.abs(Number(t.amount) || 0);
      if (t.isCredit) row.aportes += amount;
      else row.gastos += amount;
      map.set(day, row);
    });
    return [...map.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r, label: r.date.slice(8, 10) + "/" + r.date.slice(5, 7) }));
  }, [filteredTx]);

  const balanceSeries = useMemo(() => {
    const map = new Map<string, { date: string; tesouraria: number; cartoes: number }>();
    snapshots.forEach((s) => {
      const row = map.get(s.snapshot_date) ?? { date: s.snapshot_date, tesouraria: 0, cartoes: 0 };
      if (String(s.account_type || "").toLowerCase().includes("treasury")) row.tesouraria += s.available;
      else row.cartoes += s.available;
      map.set(s.snapshot_date, row);
    });
    return [...map.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r, label: r.date.slice(8, 10) + "/" + r.date.slice(5, 7) }));
  }, [snapshots]);

  const byHolder = useMemo(() => {
    const map = new Map<string, { holder: string; gastos: number; aportes: number; saldo: number | null }>();
    filteredTx.forEach((t) => {
      const key = String(t.accountAlias || t.accountName || "Sem portador");
      const row = map.get(key) ?? { holder: key, gastos: 0, aportes: 0, saldo: null };
      const amount = Math.abs(Number(t.amount) || 0);
      if (t.isCredit) row.aportes += amount;
      else row.gastos += amount;
      map.set(key, row);
    });
    accounts.forEach((a) => {
      if (!a.alias || isTreasury(a)) return;
      const row = map.get(a.alias);
      if (row) row.saldo = a.available;
      else if (a.available != null && holder === ALL && card === ALL) {
        map.set(a.alias, { holder: a.alias, gastos: 0, aportes: 0, saldo: a.available });
      }
    });
    return [...map.values()].sort((a, b) => b.gastos - a.gastos);
  }, [filteredTx, accounts, holder, card]);

  const companyLabel = getLabel(companyDb || "");
  const loading = loadingTx || loadingAccounts;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PageTitle title="Analytics de Cartões" />
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate("/cartoes/transacoes")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-muted">
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Analytics de Cartões</h1>
              <p className="text-xs text-muted-foreground">
                {companyLabel} • Saldos, aportes e gastos
                {capturedAt && ` • saldo em ${new Date(capturedAt).toLocaleString("pt-BR")}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => { void reload(); if (companyDb) void fetchTransactions(startDate, endDate, companyDb); }} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Filtros */}
          <div className="glass-card p-4 grid gap-4 md:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="start">De</Label>
              <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">Até</Label>
              <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Cartão</Label>
              <Select value={card} onValueChange={setCard}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos</SelectItem>
                  {cardOptions.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Portador</Label>
              <Select value={holder} onValueChange={setHolder}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos</SelectItem>
                  {holderOptions.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Centro de custo</Label>
              <Select value={costCenter} onValueChange={setCostCenter}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos</SelectItem>
                  {costCenterOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {notConfigured && (
            <div className="glass-card p-4 text-sm text-muted-foreground">
              Esta empresa não possui cartões corporativos configurados.
            </div>
          )}
          {accountsError && (
            <div className="glass-card p-4 text-sm text-destructive">{accountsError}</div>
          )}

          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-4">
            <KpiCard icon={<Wallet className="w-4 h-4" />} label="Saldo tesouraria" value={brl(treasuryBalance)} loading={loadingAccounts} />
            <KpiCard icon={<Wallet className="w-4 h-4" />} label="Saldo nos cartões" value={brl(cardsBalance)} loading={loadingAccounts} />
            <KpiCard icon={<TrendingUp className="w-4 h-4" />} label="Aportes no período" value={brl(totals.credits)} loading={loadingTx} />
            <KpiCard
              icon={<TrendingDown className="w-4 h-4" />}
              label="Gastos no período"
              value={brl(totals.spend)}
              hint={`${totals.count} transações • saques ${brl(totals.withdrawals)}`}
              loading={loadingTx}
            />
          </div>

          {/* Hierarquia de contas */}
          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Hierarquia de contas</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tesourarias e cartões conforme a estrutura da operadora.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Buscar conta, código ou centro de custo"
                  aria-label="Buscar conta"
                  className="w-72"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setExpandedAccounts((prev) =>
                      prev.size > 0
                        ? new Set()
                        : new Set(accountTree.filter((r) => r.hasChildren).map((r) => String(r.account.account))),
                    )
                  }
                >
                  {expandedAccounts.size > 0 ? "Recolher tudo" : "Expandir tudo"}
                </Button>
              </div>
            </div>
            {loadingAccounts ? (
              <div className="py-10 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : visibleAccountRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">
                {accountSearch.trim() ? "Nenhuma conta encontrada para a busca." : "Sem contas disponíveis."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Centro de custo</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right">Saldo consolidado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleAccountRows.map((row) => {
                    const a = row.account;
                    const treasury = isTreasury(a);
                    const key = String(a.account);
                    const open = !!accountSearch.trim() || expandedAccounts.has(key);
                    return (
                      <TableRow key={a.account}>
                        <TableCell>
                          <div
                            className="flex items-center gap-2"
                            style={{ paddingLeft: `${row.depth * 18}px` }}
                          >
                            {row.hasChildren ? (
                              <button
                                type="button"
                                onClick={() => toggleAccount(key)}
                                aria-expanded={open}
                                aria-label={open ? "Recolher conta" : "Expandir conta"}
                                className="p-0.5 rounded hover:bg-muted text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            ) : (
                              <span className="w-5" />
                            )}
                            <div>
                              <div className={treasury ? "font-semibold" : "font-medium"}>
                                {a.alias || a.account}
                              </div>
                              <div className="text-xs text-muted-foreground">{a.account}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {treasury ? "Tesouraria" : a.cards.length > 0 ? "Cartão" : (a.accountType || "—")}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.costCenter || "—"}</TableCell>
                        <TableCell className="text-right">{a.available == null ? "—" : brl(Number(a.available))}</TableCell>
                        <TableCell className="text-right font-medium">
                          {row.hasChildren ? brl(row.subtotal) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

                </TableBody>
              </Table>
            )}
          </div>



          {/* Gastos x aportes */}
          <div className="glass-card p-4">
            <h2 className="text-sm font-semibold mb-3">Aportes e gastos por dia</h2>
            {loadingTx ? (
              <div className="h-64 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : dailySeries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">Nenhuma transação no período filtrado.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v) => (Number(v) / 1000).toFixed(0) + "k"} />
                  <Tooltip formatter={(v) => brl(Number(v))} />
                  <Legend />
                  <Bar dataKey="aportes" name="Aportes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="gastos" name="Gastos" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Evolução de saldo */}
          <div className="glass-card p-4">
            <h2 className="text-sm font-semibold mb-1">Evolução do saldo</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Registrado diariamente a partir do primeiro acesso a esta tela.
            </p>
            {balanceSeries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">
                Ainda não há histórico de saldo registrado.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={balanceSeries}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v) => (Number(v) / 1000).toFixed(0) + "k"} />
                  <Tooltip formatter={(v) => brl(Number(v))} />
                  <Legend />
                  <Line type="monotone" dataKey="tesouraria" name="Tesouraria" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="cartoes" name="Cartões" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Por portador */}
          <div className="glass-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold">Por portador / conta</h2>
            </div>
            {byHolder.length === 0 ? (
              <p className="text-sm text-muted-foreground py-10 text-center">Sem dados para os filtros atuais.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Portador / conta</TableHead>
                    <TableHead className="text-right">Aportes</TableHead>
                    <TableHead className="text-right">Gastos</TableHead>
                    <TableHead className="text-right">Saldo atual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byHolder.map((r) => (
                    <TableRow key={r.holder}>
                      <TableCell className="font-medium">{r.holder}</TableCell>
                      <TableCell className="text-right">{brl(r.aportes)}</TableCell>
                      <TableCell className="text-right">{brl(r.gastos)}</TableCell>
                      <TableCell className="text-right">{r.saldo == null ? "—" : brl(r.saldo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-foreground">
        {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : value}
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
