import { Activity, Clock, FileCheck, Package, AlertTriangle, LogOut, RefreshCw, Loader2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { FlowTimeline } from "@/components/FlowTimeline";
import { MetricCard } from "@/components/MetricCard";
import { InsightsPanel } from "@/components/InsightsPanel";
import { DataUpload } from "@/components/DataUpload";
import { ValidationTable } from "@/components/ValidationTable";
import { useSap } from "@/contexts/SapContext";
import { useSapDashboard } from "@/hooks/useSapDashboard";
import { Button } from "@/components/ui/button";

const COMPANY_LABELS: Record<string, string> = {
  SBO_ANAGAMING: "ANA Gaming",
  SBO_CACTUS: "Cactus",
  SBO_INSTITUTO_ANA: "Instituto Cactus",
};

interface DashboardProps {
  embedded?: boolean;
}

export function Dashboard({ embedded = false }: DashboardProps) {
  const { session, logout } = useSap();
  const navigate = useNavigate();
  const { stages, metrics, insights, validations, isLoading, error, refresh } = useSapDashboard();
  const companyLabel = COMPANY_LABELS[session?.companyDB || ""] || session?.companyDB;

  const content = (
    <div className={embedded ? "space-y-8" : "max-w-7xl mx-auto px-6 py-8 space-y-8"}>
      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {error && (
          <div className="glass-card p-4 border-destructive/30 bg-destructive/10 text-sm text-destructive">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Carregando dados do SAP B1...</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard title="Tempo Médio Total" value={`${metrics.avgTotalDays}d`} subtitle="Requisição → Pagamento" icon={Clock} delay={0} />
              <MetricCard title="Pedidos em Aberto" value={String(metrics.openOrders)} subtitle="Aguardando fechamento" icon={Package} delay={0.1} />
              <MetricCard title="Validações com Erro" value={String(metrics.validationErrors)} subtitle="Requerem atenção" icon={AlertTriangle} delay={0.2} />
              <MetricCard title="Taxa de Conformidade" value={`${metrics.complianceRate}%`} subtitle="Lançamentos válidos" icon={FileCheck} delay={0.3} />
            </div>

            {stages.length > 0 && <FlowTimeline stages={stages} />}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                {insights.length > 0 && <InsightsPanel insights={insights} />}
              </div>
              <div>
                <DataUpload />
              </div>
            </div>

            {validations.length > 0 && <ValidationTable items={validations} />}
          </>
        )}
      </main>
    </div>
  );
}
