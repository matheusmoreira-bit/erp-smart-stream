import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Loader2, Search, Award, TrendingDown, TrendingUp, DollarSign, Users, AlertCircle, Pencil, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MetricCard } from "@/components/MetricCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useLicenseAnalysis, type LicenseRow } from "@/hooks/useLicenseAnalysis";
import { useSap } from "@/contexts/SapContext";

const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtH = (m: number) => m <= 0 ? "—" : `${(m/60).toFixed(1)}h`;

const STATUS_META: Record<LicenseRow["status"], { label: string; cls: string }> = {
  intensa: { label: "Uso Intenso", cls: "bg-success/15 text-success" },
  saudavel: { label: "Saudável", cls: "bg-primary/15 text-primary" },
  subutilizada: { label: "Subutilizada", cls: "bg-destructive/15 text-destructive" },
  "sem-licenca": { label: "Sem licença", cls: "bg-muted text-muted-foreground" },
};

export default function LicenseAnalysisPage() {
  const navigate = useNavigate();
  const { session } = useSap();
  const [period, setPeriod] = useState(90);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("with_license");
  const [pricingOpen, setPricingOpen] = useState(false);
  const { rows, pricing, loading, refresh, updateLicenseType, updatePricing } = useLicenseAnalysis(period);

  const [proPrice, setProPrice] = useState<string>("");
  const [crmPrice, setCrmPrice] = useState<string>("");

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter === "with_license") list = list.filter(r => r.has_license);
    else if (statusFilter !== "all") list = list.filter(r => r.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r => r.user_code.toLowerCase().includes(q) || r.user_name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      // subutilizadas com licença primeiro (mais oportunidade de economia)
      const order = { subutilizada: 0, saudavel: 1, intensa: 2, "sem-licenca": 3 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.monthlyCost - a.monthlyCost;
    });
  }, [rows, statusFilter, search]);

  const metrics = useMemo(() => {
    const withLic = rows.filter(r => r.has_license);
    const monthlyTotal = withLic.reduce((s, r) => s + r.monthlyCost, 0);
    const proCount = withLic.filter(r => r.license_type === "PRO").length;
    const crmCount = withLic.filter(r => r.license_type === "CRM").length;
    const subutil = withLic.filter(r => r.status === "subutilizada");
    const wasted = subutil.reduce((s, r) => s + r.monthlyCost, 0);
    return { total: withLic.length, monthlyTotal, proCount, crmCount, subutilCount: subutil.length, wasted };
  }, [rows]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/users")}><ArrowLeft className="w-5 h-5" /></Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Análise de Licenças</h1>
              <p className="text-sm text-muted-foreground">Custo-benefício por licença · {session?.companyDB || "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Dialog open={pricingOpen} onOpenChange={(o) => { setPricingOpen(o); if (o) { setProPrice(String(pricing.PRO ?? 0)); setCrmPrice(String(pricing.CRM ?? 0)); } }}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm"><DollarSign className="w-4 h-4 mr-2" />Custos</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Custo mensal das licenças</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <label className="block text-sm">PRO (R$/mês)
                    <Input type="number" value={proPrice} onChange={(e) => setProPrice(e.target.value)} className="mt-1" />
                  </label>
                  <label className="block text-sm">CRM (R$/mês)
                    <Input type="number" value={crmPrice} onChange={(e) => setCrmPrice(e.target.value)} className="mt-1" />
                  </label>
                </div>
                <DialogFooter>
                  <Button onClick={async () => {
                    await updatePricing("PRO", Number(proPrice) || 0);
                    await updatePricing("CRM", Number(crmPrice) || 0);
                    setPricingOpen(false);
                  }}>Salvar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Atualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar usuário..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 bg-card" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[200px] bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="with_license">Apenas com licença</SelectItem>
              <SelectItem value="subutilizada">Subutilizadas</SelectItem>
              <SelectItem value="saudavel">Saudáveis</SelectItem>
              <SelectItem value="intensa">Uso intenso</SelectItem>
              <SelectItem value="all">Todos usuários</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v))}>
            <SelectTrigger className="w-[160px] bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="60">Últimos 60 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="180">Últimos 180 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Carregando...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <MetricCard title="Licenças Ativas" value={String(metrics.total)} icon={Users} delay={0} />
              <MetricCard title="PRO / CRM" value={`${metrics.proCount} / ${metrics.crmCount}`} icon={Award} delay={0.05} />
              <MetricCard title="Custo Mensal" value={fmtBRL(metrics.monthlyTotal)} icon={DollarSign} delay={0.1} />
              <MetricCard title="Subutilizadas" value={String(metrics.subutilCount)} icon={TrendingDown} delay={0.15} trend={metrics.subutilCount > 0 ? { value: String(metrics.subutilCount), positive: false } : undefined} />
              <MetricCard title="Economia Potencial" value={fmtBRL(metrics.wasted)} icon={AlertCircle} delay={0.2} />
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-6 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Análise por usuário</h3>
                  <p className="text-xs text-muted-foreground">{filtered.length} usuário(s) · período de {period} dias</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-card">
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3 text-left">Usuário</th>
                      <th className="px-4 py-3 text-left">Licença</th>
                      <th className="px-4 py-3 text-right">Logins</th>
                      <th className="px-4 py-3 text-right">Tempo</th>
                      <th className="px-4 py-3 text-right">Custo Mensal</th>
                      <th className="px-4 py-3 text-right">R$/login</th>
                      <th className="px-4 py-3 text-right">R$/hora</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-foreground">{r.user_name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{r.user_code}{r.is_locked && " · 🔒"}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          {r.has_license ? (
                            <Badge variant="secondary" className={r.license_type === "PRO" ? "bg-primary/15 text-primary" : "bg-accent/30 text-foreground"}>
                              {r.license_type || "—"}
                            </Badge>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{r.logins || "—"}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{fmtH(r.totalMinutes)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{r.monthlyCost > 0 ? fmtBRL(r.monthlyCost) : "—"}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{r.costPerLogin != null ? fmtBRL(r.costPerLogin) : "—"}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{r.costPerHour != null ? fmtBRL(r.costPerHour) : "—"}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="secondary" className={STATUS_META[r.status].cls}>{STATUS_META[r.status].label}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <Select
                            value={r.has_license ? (r.license_type || "PRO") : "none"}
                            onValueChange={async (v) => {
                              if (v === "none") await updateLicenseType(r, null, false);
                              else await updateLicenseType(r, v as "PRO" | "CRM", true);
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PRO">PRO</SelectItem>
                              <SelectItem value="CRM">CRM</SelectItem>
                              <SelectItem value="none">Sem</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={9} className="text-center text-muted-foreground py-8">Nenhum usuário encontrado</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground space-y-1">
              <p><strong className="text-foreground">Como interpretamos:</strong></p>
              <p>• <strong>Subutilizada:</strong> bloqueado, sem logins ou &lt; 0.5h/dia médio no período</p>
              <p>• <strong>Saudável:</strong> entre 0.5h e 2h/dia médio</p>
              <p>• <strong>Uso intenso:</strong> &gt; 2h/dia médio</p>
              <p>• Custo proporcional ao período selecionado (mensal × dias/30)</p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
