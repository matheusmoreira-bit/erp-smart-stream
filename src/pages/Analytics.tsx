import { useMemo } from "react";
import { useSap } from "@/contexts/SapContext";
import { SapLoginForm } from "@/components/SapLoginForm";
import { Dashboard } from "@/components/Dashboard";
import { PaymentAnalysis } from "@/components/PaymentAnalysis";
import { ReportAiChat } from "@/components/ReportAiChat";
import { Activity, ArrowLeft, LogOut, CreditCard, GitBranch } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSapDashboard } from "@/hooks/useSapDashboard";
import { usePaymentAnalysis } from "@/hooks/usePaymentAnalysis";
import { useCompanies } from "@/hooks/useCompanies";

export default function AnalyticsPage() {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getLabel } = useCompanies(true);

  if (!session) return <SapLoginForm />;

  const activeTab = searchParams.get("tab") || "fluxo";
  const companyLabel = getLabel(session.companyDB);

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 glow-primary">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">SAP B1 <span className="text-gradient">Analytics</span></h1>
              <p className="text-xs text-muted-foreground">{companyLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
              {session.userName}
            </div>
            <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground hover:text-foreground">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Menu
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="fluxo" className="gap-1.5">
              <GitBranch className="w-4 h-4" />
              Fluxo de Compras
            </TabsTrigger>
            <TabsTrigger value="pagamentos" className="gap-1.5">
              <CreditCard className="w-4 h-4" />
              Análise de Pagamentos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="fluxo" className="mt-6">
            <Dashboard embedded />
          </TabsContent>

          <TabsContent value="pagamentos" className="mt-6">
            <PaymentAnalysis />
          </TabsContent>
        </Tabs>
      </main>

      <AnalyticsAiChat activeTab={activeTab} />
    </div>
  );
}

/** Wrapper that builds report context for the AI based on active tab */
function AnalyticsAiChat({ activeTab }: { activeTab: string }) {
  const dashboard = useSapDashboard();
  const payments = usePaymentAnalysis();

  const reportContext = useMemo(() => {
    if (activeTab === "fluxo") {
      const { stages, metrics, validations } = dashboard;
      const stagesSummary = stages
        .map((s) => `${s.name}: média ${s.avgDays}d (meta: ${s.targetDays}d) - ${s.count} docs - status: ${s.status}`)
        .join("\n");
      const errorItems = validations
        .filter((v) => v.status === "error")
        .slice(0, 20)
        .map((v) => `• ${v.document} (${v.supplier}): ${v.message}`)
        .join("\n");

      return `RELATÓRIO: Fluxo de Compras
Métricas:
- Tempo médio total: ${metrics.avgTotalDays} dias
- Pedidos em aberto: ${metrics.openOrders}
- Validações com erro: ${metrics.validationErrors}
- Taxa de conformidade: ${metrics.complianceRate}%

Etapas do fluxo:
${stagesSummary}

Principais erros (até 20):
${errorItems || "Nenhum erro encontrado"}

Total de validações: ${validations.length}`;
    }

    // Pagamentos tab
    const { rows } = payments;
    if (!rows.length) return "RELATÓRIO: Análise de Pagamentos\nNenhum dado disponível.";

    const totalRows = rows.length;
    const columns = Object.keys(rows[0]);
    const sample = rows.slice(0, 5).map((r) =>
      columns.map((c) => `${c}: ${r[c] ?? "—"}`).join(", ")
    ).join("\n");

    return `RELATÓRIO: Análise de Pagamentos
Total de registros: ${totalRows}
Colunas: ${columns.join(", ")}

Amostra (primeiros 5 registros):
${sample}`;
  }, [activeTab, dashboard, payments]);

  return <ReportAiChat reportContext={reportContext} />;
}
