import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SapProvider } from "@/contexts/SapContext";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { PermissionsV2Provider } from "@/contexts/PermissionsV2Context";
import Index from "./pages/Index.tsx";
import ApprovalLink from "./pages/ApprovalLink.tsx";
import AnalyticsPage from "./pages/Analytics.tsx";
import ApprovalsHub from "./pages/ApprovalsHub.tsx";
import MobileApprovals from "./pages/MobileApprovals.tsx";
import MobileInvoiceCapture from "./pages/MobileInvoiceCapture.tsx";
import Expenses from "./pages/Expenses.tsx";
import SalesHub from "./pages/SalesHub.tsx";
import BaixasHistory from "./pages/BaixasHistory.tsx";
import ApprovalRules from "./pages/ApprovalRules.tsx";
import ApprovalMatrix from "./pages/ApprovalMatrix.tsx";

import PagCorp from "./pages/PagCorp.tsx";
import PagCorpMapping from "./pages/PagCorpMapping.tsx";
import PagCorpNondeductible from "./pages/PagCorpNondeductible.tsx";
import PagCorpSettlements from "./pages/PagCorpSettlements.tsx";
import IntegrationHistory from "./pages/IntegrationHistory.tsx";
import UsersHub from "./pages/UsersHub.tsx";
import UserProductivity from "./pages/UserProductivity.tsx";
import Suppliers from "./pages/Suppliers.tsx";
import Items from "./pages/Items.tsx";
import RegistrationRequests from "./pages/RegistrationRequests.tsx";
import Intercompany from "./pages/Intercompany.tsx";
import FinancialReview from "./pages/FinancialReview.tsx";
import CashflowForecast from "./pages/CashflowForecast.tsx";
import AdvancePayments from "./pages/AdvancePayments.tsx";
import NfEntrada from "./pages/NfEntrada.tsx";

import AuditHub from "./pages/AuditHub.tsx";
import IntegrationsHub from "./pages/IntegrationsHub.tsx";
import Notifications from "./pages/Notifications.tsx";
import NotificationGovernance from "./pages/NotificationGovernance.tsx";
import Profile from "./pages/Profile.tsx";
import NotFound from "./pages/NotFound.tsx";
import Backoffice from "./pages/Admin.tsx";
import SapUsersReplicate from "./pages/SapUsersReplicate.tsx";
import AuditTrail from "./pages/AuditTrail.tsx";
import TransferApprovalsHistory from "./pages/TransferApprovalsHistory.tsx";
import SapStatusSync from "./pages/SapStatusSync.tsx";
import SapSyncRuns from "./pages/SapSyncRuns.tsx";
import BackofficeCopilot from "./pages/BackofficeCopilot.tsx";
import InfraHealth from "./pages/InfraHealth.tsx";
import DbPerformance from "./pages/DbPerformance.tsx";
import FlowPerformance from "./pages/FlowPerformance.tsx";
import IntegrationHealth from "./pages/IntegrationHealth.tsx";
import AuditTimeline from "./pages/AuditTimeline.tsx";
import AccessReview from "./pages/AccessReview.tsx";
import ApiKeys from "./pages/ApiKeys.tsx";

import SlaEscalation from "./pages/SlaEscalation.tsx";
import SlaDashboard from "./pages/SlaDashboard.tsx";
import BackofficeRetryQueue from "./pages/BackofficeRetryQueue.tsx";
import BackofficeRoadmap from "./pages/BackofficeRoadmap.tsx";

import PagCorpSettlementAudit from "./pages/PagCorpSettlementAudit.tsx";
import { AdminRoute } from "./components/AdminRoute.tsx";
import { GlobalAiChat } from "./components/GlobalAiChat.tsx";
import { WhatsNewWizard } from "./components/WhatsNewWizard.tsx";
import { OnboardingTour } from "./components/OnboardingTour.tsx";

import { StickyHeaderMeasure } from "./components/StickyHeaderMeasure.tsx";
import { ModuleSubmenu } from "./components/ModuleSubmenu.tsx";
import { TestCompanyBanner } from "./components/TestCompanyBanner.tsx";
import { TestCompanyVisibilityGate } from "./components/TestCompanyVisibilityGate.tsx";
import { DefaultPasswordWarning } from "./components/DefaultPasswordWarning.tsx";
import { MobileBottomNav } from "./components/MobileBottomNav.tsx";
import { RequireAuth } from "./components/RequireAuth.tsx";
import Login from "./pages/Login.tsx";


const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="erp-theme">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SapProvider>
          <PermissionsV2Provider>
          <TestCompanyVisibilityGate />
          <BrowserRouter>
            <StickyHeaderMeasure />
            <ModuleSubmenu />
            <RequireAuth>
            <Routes>
              <Route path="/" element={<Index />} />

              {/* Login — público */}
              <Route path="/login" element={<Login />} />

              {/* Aprovação por link assinado (e-mail / Slack) — público */}
              <Route path="/aprovar/:token" element={<ApprovalLink />} />



              {/* Backoffice */}
              <Route path="/backoffice/login" element={<Navigate to="/backoffice" replace />} />
              <Route path="/backoffice" element={<AdminRoute><Backoffice /></AdminRoute>} />
              <Route path="/backoffice/sap-users" element={<Navigate to="/usuarios/sap" replace />} />
              <Route path="/backoffice/sap-users/replicate" element={<AdminRoute><SapUsersReplicate /></AdminRoute>} />
              <Route path="/backoffice/audit-trail" element={<AdminRoute><AuditTrail /></AdminRoute>} />
              <Route path="/backoffice/trilha-documento" element={<AdminRoute><AuditTimeline /></AdminRoute>} />
              <Route path="/backoffice/transfer-history" element={<AdminRoute><TransferApprovalsHistory /></AdminRoute>} />
              <Route path="/backoffice/sap-sync" element={<AdminRoute><SapStatusSync /></AdminRoute>} />
              <Route path="/backoffice/sap-sync/execucoes" element={<AdminRoute><SapSyncRuns /></AdminRoute>} />
              <Route path="/backoffice/copiloto" element={<AdminRoute><BackofficeCopilot /></AdminRoute>} />
              <Route path="/backoffice/infra-health" element={<AdminRoute><InfraHealth /></AdminRoute>} />
              <Route path="/backoffice/desempenho-banco" element={<AdminRoute><DbPerformance /></AdminRoute>} />
              <Route path="/backoffice/performance" element={<AdminRoute><FlowPerformance /></AdminRoute>} />
              <Route path="/backoffice/saude-integracoes" element={<AdminRoute><IntegrationHealth /></AdminRoute>} />
              <Route path="/backoffice/retry-queue" element={<AdminRoute><BackofficeRetryQueue /></AdminRoute>} />
              <Route path="/backoffice/revisao-acessos" element={<AdminRoute><AccessReview /></AdminRoute>} />
              <Route path="/backoffice/chaves-api" element={<AdminRoute><ApiKeys /></AdminRoute>} />

              <Route path="/backoffice/sla-escalonamento" element={<AdminRoute><SlaEscalation /></AdminRoute>} />
              <Route path="/backoffice/sla-dashboard" element={<AdminRoute><SlaDashboard /></AdminRoute>} />
              <Route path="/backoffice/roadmap" element={<AdminRoute><BackofficeRoadmap /></AdminRoute>} />

              <Route path="/backoffice/baixas-pagcorp" element={<AdminRoute><PagCorpSettlementAudit /></AdminRoute>} />



              {/* Analytics */}
              <Route path="/analytics" element={<AnalyticsPage />} />

              {/* Operação */}
              <Route path="/compras" element={<Expenses />} />
              <Route path="/vendas" element={<Navigate to="/vendas/pedidos" replace />} />
              <Route path="/vendas/pedidos" element={<SalesHub tab="orders" />} />
              <Route path="/vendas/nfse" element={<SalesHub tab="nfse" />} />
              <Route path="/vendas/recebimentos" element={<SalesHub tab="receivables" />} />
              <Route path="/vendas/destinatarios" element={<SalesHub tab="recipients" />} />
              <Route path="/vendas/historico" element={<BaixasHistory />} />

              {/* Aprovações */}
              <Route path="/aprovacoes" element={<ApprovalsHub />} />
              <Route path="/aprovacoes/mobile" element={<MobileApprovals />} />
              <Route path="/captura/nota" element={<MobileInvoiceCapture />} />
              <Route path="/aprovacoes/regras" element={<ApprovalRules />} />
              <Route path="/aprovacoes/matriz" element={<ApprovalMatrix />} />


              {/* Cartões Corporativos */}
              <Route path="/cartoes" element={<Navigate to="/cartoes/transacoes" replace />} />
              <Route path="/cartoes/transacoes" element={<PagCorp />} />
              <Route path="/cartoes/mapeamento" element={<PagCorpMapping />} />
              <Route path="/cartoes/indedutiveis" element={<PagCorpNondeductible />} />
              <Route path="/cartoes/baixas" element={<PagCorpSettlements />} />
              <Route path="/cartoes/historico" element={<IntegrationHistory />} />

              {/* Auditoria */}
              <Route path="/auditoria" element={<Navigate to="/auditoria/geral" replace />} />
              <Route path="/auditoria/geral" element={<AuditHub tab="geral" />} />
              <Route path="/auditoria/geral/:section" element={<AuditHub tab="geral" />} />
              <Route path="/auditoria/geral/:section/:id" element={<AuditHub tab="geral" />} />
              {/* Rotas legadas → módulo unificado */}
              <Route path="/auditoria/sap/*" element={<Navigate to="/auditoria/geral/sap-dashboard" replace />} />
              <Route path="/auditoria/pagamentos/*" element={<Navigate to="/auditoria/geral/pay-dashboard" replace />} />
              <Route path="/auditoria/fiscal" element={<Navigate to="/auditoria/geral/fiscal" replace />} />
              <Route path="/auditoria/cruzamento" element={<AuditHub tab="cruzamento" />} />
              <Route path="/auditoria/totais" element={<AuditHub tab="totais" />} />
              <Route path="/auditoria/kyp" element={<AuditHub tab="kyp" />} />

              <Route path="/auditoria/logs" element={<AuditHub tab="logs" />} />

              {/* Integrações */}
              <Route path="/integracoes" element={<Navigate to="/integracoes/automacoes" replace />} />
              <Route path="/integracoes/automacoes" element={<IntegrationsHub tab="automations" />} />
              <Route path="/integracoes/monitor" element={<IntegrationsHub tab="monitor" />} />
              <Route path="/integracoes/credenciais" element={<IntegrationsHub tab="credentials" />} />
              <Route path="/integracoes/colaboradores" element={<IntegrationsHub tab="employees" />} />

              {/* Usuários */}
              <Route path="/usuarios" element={<Navigate to="/usuarios/lista" replace />} />
              <Route path="/usuarios/lista" element={<UsersHub tab="list" />} />
              <Route path="/usuarios/permissoes" element={<UsersHub tab="permissions" />} />
              <Route path="/usuarios/administradores" element={<Navigate to="/usuarios/lista?seg=admins" replace />} />
              <Route path="/usuarios/sap" element={<Navigate to="/usuarios/lista?seg=sap" replace />} />
              <Route path="/usuarios/atividade" element={<UsersHub tab="activity" />} />
              <Route path="/usuarios/produtividade" element={<Navigate to="/analytics/produtividade" replace />} />
              <Route path="/analytics/produtividade" element={<UserProductivity />} />
              <Route path="/usuarios/sincronizacao-idp" element={<UsersHub tab="idp" />} />
              <Route path="/usuarios/licencas" element={<UsersHub tab="licenses" />} />
              <Route path="/usuarios/importar-licencas" element={<UsersHub tab="licenses-import" />} />

              {/* Cadastros */}
              <Route path="/cadastros/fornecedores" element={<Suppliers />} />
              
              <Route path="/cadastros/itens" element={<Items />} />
              <Route path="/cadastros/solicitacoes" element={<Navigate to="/solicitacoes" replace />} />
              <Route path="/cadastros/intercompany" element={<Intercompany />} />

              {/* Solicitações de cadastro (módulo próprio) */}
              <Route path="/solicitacoes" element={<RegistrationRequests />} />

              {/* Financeiro */}
              <Route path="/financeiro/adiantamentos" element={<AdvancePayments />} />
              <Route path="/financeiro/reconciliacao" element={<FinancialReview />} />
              <Route path="/financeiro/previsao-caixa" element={<CashflowForecast />} />
              <Route path="/financeiro/nf-entrada" element={<NfEntrada />} />

              {/* Notificações */}
              <Route path="/notificacoes" element={<Notifications />} />
              <Route path="/notificacoes/regras" element={<NotificationGovernance />} />

              {/* Perfil intercompany */}
              <Route path="/perfil" element={<Profile />} />

              <Route path="*" element={<NotFound />} />
            </Routes>
            </RequireAuth>
            <MobileBottomNav />
          </BrowserRouter>
          <TestCompanyBanner />
          <DefaultPasswordWarning />
          <WhatsNewWizard />
          <OnboardingTour />
          <ImpersonationBanner />
          <GlobalAiChat />

          </PermissionsV2Provider>
        </SapProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
