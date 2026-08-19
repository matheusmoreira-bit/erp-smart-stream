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
import { ModuleRoute } from "./components/ModuleRoute.tsx";
import Login from "./pages/Login.tsx";


const queryClient = new QueryClient();
const protect = (moduleKey: string, element: JSX.Element) => (
  <ModuleRoute moduleKey={moduleKey}>{element}</ModuleRoute>
);

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
              <Route path="/analytics" element={protect("analytics", <AnalyticsPage />)} />

              {/* Operação */}
              <Route path="/compras" element={protect("expenses", <Expenses />)} />
              <Route path="/vendas" element={<Navigate to="/vendas/pedidos" replace />} />
              <Route path="/vendas/pedidos" element={protect("sales", <SalesHub tab="orders" />)} />
              <Route path="/vendas/nfse" element={protect("sales", <SalesHub tab="nfse" />)} />
              <Route path="/vendas/adiantamentos" element={protect("sales", <SalesHub tab="advances" />)} />
              <Route path="/vendas/recebimentos" element={protect("sales", <SalesHub tab="receivables" />)} />
              <Route path="/vendas/destinatarios" element={protect("sales", <SalesHub tab="recipients" />)} />
              <Route path="/vendas/historico" element={protect("sales", <BaixasHistory />)} />

              {/* Aprovações */}
              <Route path="/aprovacoes" element={protect("approvals", <ApprovalsHub />)} />
              <Route path="/aprovacoes/mobile" element={protect("approvals", <MobileApprovals />)} />
              <Route path="/captura/nota" element={protect("expenses", <MobileInvoiceCapture />)} />
              <Route path="/aprovacoes/regras" element={protect("approval_rules", <ApprovalRules />)} />
              <Route path="/aprovacoes/matriz" element={protect("approval_rules", <ApprovalMatrix />)} />


              {/* Cartões Corporativos */}
              <Route path="/cartoes" element={<Navigate to="/cartoes/transacoes" replace />} />
              <Route path="/cartoes/transacoes" element={protect("pagcorp", <PagCorp />)} />
              <Route path="/cartoes/mapeamento" element={protect("pagcorp", <PagCorpMapping />)} />
              <Route path="/cartoes/indedutiveis" element={protect("pagcorp", <PagCorpNondeductible />)} />
              <Route path="/cartoes/baixas" element={protect("pagcorp", <PagCorpSettlements />)} />
              <Route path="/cartoes/historico" element={protect("pagcorp", <IntegrationHistory />)} />

              {/* Auditoria */}
              <Route path="/auditoria" element={<Navigate to="/auditoria/geral" replace />} />
              <Route path="/auditoria/geral" element={protect("audit_console", <AuditHub tab="geral" />)} />
              <Route path="/auditoria/geral/:section" element={protect("audit_console", <AuditHub tab="geral" />)} />
              <Route path="/auditoria/geral/:section/:id" element={protect("audit_console", <AuditHub tab="geral" />)} />
              {/* Rotas legadas → módulo unificado */}
              <Route path="/auditoria/sap/*" element={<Navigate to="/auditoria/geral/sap-dashboard" replace />} />
              <Route path="/auditoria/pagamentos/*" element={<Navigate to="/auditoria/geral/pay-dashboard" replace />} />
              <Route path="/auditoria/fiscal" element={<Navigate to="/auditoria/geral/fiscal" replace />} />
              <Route path="/auditoria/cruzamento" element={protect("audit_console", <AuditHub tab="cruzamento" />)} />
              <Route path="/auditoria/totais" element={protect("audit_console", <AuditHub tab="totais" />)} />
              <Route path="/auditoria/kyp" element={protect("audit_console", <AuditHub tab="kyp" />)} />

              <Route path="/auditoria/logs" element={protect("audit_console", <AuditHub tab="logs" />)} />

              {/* Integrações */}
              <Route path="/integracoes" element={<Navigate to="/integracoes/automacoes" replace />} />
              <Route path="/integracoes/automacoes" element={protect("synapse", <IntegrationsHub tab="automations" />)} />
              <Route path="/integracoes/monitor" element={protect("integration_history", <IntegrationsHub tab="monitor" />)} />
              <Route path="/integracoes/credenciais" element={protect("credentials", <IntegrationsHub tab="credentials" />)} />
              <Route path="/integracoes/colaboradores" element={protect("employee_integration", <IntegrationsHub tab="employees" />)} />

              {/* Usuários */}
              <Route path="/usuarios" element={<Navigate to="/usuarios/lista" replace />} />
              <Route path="/usuarios/lista" element={protect("users", <UsersHub tab="list" />)} />
              <Route path="/usuarios/permissoes" element={protect("users", <UsersHub tab="permissions" />)} />
              <Route path="/usuarios/administradores" element={<Navigate to="/usuarios/lista?seg=admins" replace />} />
              <Route path="/usuarios/sap" element={<Navigate to="/usuarios/lista?seg=sap" replace />} />
              <Route path="/usuarios/atividade" element={protect("users", <UsersHub tab="activity" />)} />
              <Route path="/usuarios/produtividade" element={<Navigate to="/analytics/produtividade" replace />} />
              <Route path="/analytics/produtividade" element={protect("users_productivity", <UserProductivity />)} />
              <Route path="/usuarios/sincronizacao-idp" element={protect("users", <UsersHub tab="idp" />)} />
              <Route path="/usuarios/licencas" element={protect("users", <UsersHub tab="licenses" />)} />
              <Route path="/usuarios/importar-licencas" element={protect("users", <UsersHub tab="licenses-import" />)} />

              {/* Cadastros */}
              <Route path="/cadastros/fornecedores" element={protect("suppliers", <Suppliers />)} />
              
              <Route path="/cadastros/itens" element={protect("items", <Items />)} />
              <Route path="/cadastros/solicitacoes" element={<Navigate to="/solicitacoes" replace />} />
              <Route path="/cadastros/intercompany" element={protect("intercompany", <Intercompany />)} />

              {/* Solicitações de cadastro (módulo próprio) */}
              <Route path="/solicitacoes" element={protect("suppliers", <RegistrationRequests />)} />

              {/* Financeiro */}
              <Route path="/financeiro/adiantamentos" element={protect("financial_review", <AdvancePayments />)} />
              <Route path="/financeiro/reconciliacao" element={protect("financial_review", <FinancialReview />)} />
              <Route path="/financeiro/previsao-caixa" element={protect("financial_review", <CashflowForecast />)} />
              <Route path="/financeiro/nf-entrada" element={protect("nf_entrada", <NfEntrada />)} />

              {/* Notificações */}
              <Route path="/notificacoes" element={protect("notifications", <Notifications />)} />
              <Route path="/notificacoes/regras" element={protect("notifications", <NotificationGovernance />)} />

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
