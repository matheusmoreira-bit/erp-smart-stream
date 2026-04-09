import { motion } from "framer-motion";
import { Activity, Clock, FileCheck, Package, TrendingDown, AlertTriangle } from "lucide-react";
import { FlowTimeline, type FlowStage } from "@/components/FlowTimeline";
import { MetricCard } from "@/components/MetricCard";
import { InsightsPanel, type Insight } from "@/components/InsightsPanel";
import { DataUpload } from "@/components/DataUpload";
import { ValidationTable, type ValidationItem } from "@/components/ValidationTable";

const mockStages: FlowStage[] = [
  { id: "req", name: "Requisição", avgDays: 1.2, targetDays: 2, status: "ok", count: 145 },
  { id: "quot", name: "Cotação", avgDays: 4.8, targetDays: 3, status: "warning", count: 132 },
  { id: "approval", name: "Aprovação", avgDays: 7.5, targetDays: 3, status: "critical", count: 128 },
  { id: "po", name: "Pedido", avgDays: 1.5, targetDays: 2, status: "ok", count: 118 },
  { id: "receipt", name: "Recebimento", avgDays: 3.2, targetDays: 5, status: "ok", count: 110 },
  { id: "invoice", name: "NF Entrada", avgDays: 2.8, targetDays: 2, status: "warning", count: 105 },
  { id: "payment", name: "Pagamento", avgDays: 4.1, targetDays: 5, status: "ok", count: 98 },
];

const mockInsights: Insight[] = [
  {
    id: "1",
    type: "bottleneck",
    title: "Aprovação é o maior gargalo",
    description: "A etapa de aprovação leva em média 7.5 dias, 150% acima da meta de 3 dias. Considere implementar aprovação automática para valores abaixo de R$ 5.000 e notificações por e-mail para aprovadores pendentes.",
    impact: "alto",
  },
  {
    id: "2",
    type: "improvement",
    title: "Cotação acima da meta",
    description: "O processo de cotação está levando 4.8 dias em média (meta: 3 dias). Sugestão: criar um catálogo de fornecedores pré-aprovados para itens recorrentes, eliminando a necessidade de cotação.",
    impact: "médio",
  },
  {
    id: "3",
    type: "alert",
    title: "NF Entrada com atrasos pontuais",
    description: "Embora a média esteja próxima da meta, 23% das notas fiscais de entrada ultrapassam 5 dias. Verificar se há bloqueios no MIRO ou divergências de quantidade/preço.",
    impact: "médio",
  },
  {
    id: "4",
    type: "positive",
    title: "Requisição e Pedido dentro da meta",
    description: "As etapas de requisição (1.2d) e criação de pedido (1.5d) estão operando com eficiência. O fluxo automatizado do SAP B1 está funcionando corretamente nestas etapas.",
    impact: "baixo",
  },
];

const mockValidations: ValidationItem[] = [
  { id: "1", document: "PC-2024-001", supplier: "ABC Materiais", stage: "Aprovação", status: "error", message: "Pedido sem 3 cotações obrigatórias para valor > R$10.000", date: "2024-03-15" },
  { id: "2", document: "PC-2024-002", supplier: "Tech Solutions", stage: "NF Entrada", status: "warning", message: "Divergência de 2.3% no preço unitário vs pedido de compra", date: "2024-03-14" },
  { id: "3", document: "PC-2024-003", supplier: "Log Express", stage: "Recebimento", status: "valid", message: "Lançamento validado com sucesso", date: "2024-03-14" },
  { id: "4", document: "PC-2024-004", supplier: "Ferro & Aço", stage: "Pagamento", status: "warning", message: "Vencimento em 2 dias, pagamento ainda não agendado", date: "2024-03-13" },
  { id: "5", document: "PC-2024-005", supplier: "EletroComp", stage: "Cotação", status: "error", message: "Fornecedor sem cadastro atualizado no SAP B1", date: "2024-03-12" },
  { id: "6", document: "PC-2024-006", supplier: "Plásticos BR", stage: "Pedido", status: "valid", message: "Lançamento validado com sucesso", date: "2024-03-12" },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 glow-primary">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">SAP B1 <span className="text-gradient">Analytics</span></h1>
              <p className="text-xs text-muted-foreground">Validação e análise de fluxo de compras</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse-glow" />
            Conectado ao SAP B1
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Tempo Médio Total"
            value="25.1d"
            subtitle="Requisição → Pagamento"
            icon={Clock}
            trend={{ value: "3.2d", positive: true }}
            delay={0}
          />
          <MetricCard
            title="Pedidos em Aberto"
            value="47"
            subtitle="Em diferentes etapas"
            icon={Package}
            delay={0.1}
          />
          <MetricCard
            title="Validações com Erro"
            value="12"
            subtitle="Requerem atenção"
            icon={AlertTriangle}
            trend={{ value: "4", positive: false }}
            delay={0.2}
          />
          <MetricCard
            title="Taxa de Conformidade"
            value="87%"
            subtitle="Lançamentos válidos"
            icon={FileCheck}
            trend={{ value: "2%", positive: true }}
            delay={0.3}
          />
        </div>

        {/* Flow Timeline */}
        <FlowTimeline stages={mockStages} />

        {/* Two columns: Insights + Upload */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <InsightsPanel insights={mockInsights} />
          </div>
          <div>
            <DataUpload />
          </div>
        </div>

        {/* Validation Table */}
        <ValidationTable items={mockValidations} />
      </main>
    </div>
  );
};

export default Index;
