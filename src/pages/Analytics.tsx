import { useMemo } from "react";
import { useSap } from "@/contexts/SapContext";
import { SapLoginForm } from "@/components/SapLoginForm";
import { Dashboard } from "@/components/Dashboard";
import { PaymentAnalysis } from "@/components/PaymentAnalysis";
import { ReportAiChat } from "@/components/ReportAiChat";
import { PendingApprovalsReport } from "@/components/PendingApprovalsReport";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Activity, ArrowLeft, LogOut, CreditCard, GitBranch, ClipboardCheck } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSapDashboard } from "@/hooks/useSapDashboard";
import { usePaymentAnalysis } from "@/hooks/usePaymentAnalysis";
import { useCompanies } from "@/hooks/useCompanies";
import { useModuleAccess } from "@/hooks/usePermissions";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PageTitle } from "@/components/PageTitle";

export default function AnalyticsPage() {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getLabel } = useCompanies(true);
  const { hasAccess: hasPaymentsAccess } = useModuleAccess("analytics_payments");

  if (!session) return <SapLoginForm />;

  const activeTab = searchParams.get("tab") || "fluxo";
  const companyLabel = getLabel(session.companyDB);

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Analytics" />
      <header className="border-b border-border px-4 sm:px-6 py-3 sm:py-4">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-3 lg:items-center">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 glow-primary shrink-0">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-foreground truncate">SAP B1 <span className="text-gradient">Analytics</span></h1>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{companyLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 lg:justify-end">
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse-glow shrink-0" />
              <span className="truncate">{session.userName}</span>
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground hover:text-foreground" aria-label="Sair">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Menu
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full sm:w-auto justify-start overflow-x-auto scrollbar-none snap-x">
            <TabsTrigger value="fluxo" className="gap-1.5 shrink-0 snap-start">
              <GitBranch className="w-4 h-4" />
              <span className="hidden xs:inline sm:inline">Fluxo de Compras</span>
              <span className="xs:hidden sm:hidden">Fluxo</span>
            </TabsTrigger>
            <TabsTrigger value="aprovacoes" className="gap-1.5 shrink-0 snap-start">
              <ClipboardCheck className="w-4 h-4" />
              <span className="hidden sm:inline">Pedidos em Aprovação</span>
              <span className="sm:hidden">Aprovações</span>
            </TabsTrigger>
            {hasPaymentsAccess && (
              <TabsTrigger value="pagamentos" className="gap-1.5 shrink-0 snap-start">
                <CreditCard className="w-4 h-4" />
                <span className="hidden sm:inline">Análise de Pagamentos</span>
                <span className="sm:hidden">Pagamentos</span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="fluxo" className="mt-6">
            <Dashboard embedded />
          </TabsContent>

          <TabsContent value="aprovacoes" className="mt-6">
            <PendingApprovalsReport />
          </TabsContent>

          <TabsContent value="pagamentos" className="mt-6">
            <ErrorBoundary
              fallbackTitle="Erro ao carregar Análise de Pagamentos"
              fallbackMessage="Alguns registros vieram com dados incompletos. Tente atualizar ou selecionar outro período."
            >
              <PaymentAnalysis />
            </ErrorBoundary>
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
