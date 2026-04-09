import { useSap } from "@/contexts/SapContext";
import { SapLoginForm } from "@/components/SapLoginForm";
import { Dashboard } from "@/components/Dashboard";
import { PaymentAnalysis } from "@/components/PaymentAnalysis";
import { Activity, ArrowLeft, LogOut, RefreshCw, CreditCard, GitBranch } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const COMPANY_LABELS: Record<string, string> = {
  SBO_ANAGAMING: "ANA Gaming",
  SBO_CACTUS: "Cactus",
  SBO_INSTITUTO_ANA: "Instituto Cactus",
};

export default function AnalyticsPage() {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  if (!session) return <SapLoginForm />;

  const activeTab = searchParams.get("tab") || "fluxo";
  const companyLabel = COMPANY_LABELS[session.companyDB] || session.companyDB;

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
    </div>
  );
}
