import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SapProvider } from "@/contexts/SapContext";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { PermissionsV2Provider } from "@/contexts/PermissionsV2Context";
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
import { Loader2 } from "lucide-react";

const Index = lazy(() => import("./pages/Index.tsx"));
const ApprovalLink = lazy(() => import("./pages/ApprovalLink.tsx"));
const AnalyticsPage = lazy(() => import("./pages/Analytics.tsx"));
const ApprovalsHub = lazy(() => import("./pages/ApprovalsHub.tsx"));
const MobileApprovals = lazy(() => import("./pages/MobileApprovals.tsx"));
const MobileInvoiceCapture = lazy(() => import("./pages/MobileInvoiceCapture.tsx"));
const Expenses = lazy(() => import("./pages/Expenses.tsx"));
const SalesHub = lazy(() => import("./pages/SalesHub.tsx"));
const BaixasHistory = lazy(() => import("./pages/BaixasHistory.tsx"));
const ApprovalRules = lazy(() => import("./pages/ApprovalRules.tsx"));
const ApprovalMatrix = lazy(() => import("./pages/ApprovalMatrix.tsx"));
const PagCorp = lazy(() => import("./pages/PagCorp.tsx"));
const PagCorpMapping = lazy(() => import("./pages/PagCorpMapping.tsx"));
const PagCorpNondeductible = lazy(() => import("./pages/PagCorpNondeductible.tsx"));
const PagCorpSettlements = lazy(() => import("./pages/PagCorpSettlements.tsx"));
const IntegrationHistory = lazy(() => import("./pages/IntegrationHistory.tsx"));
const UsersHub = lazy(() => import("./pages/UsersHub.tsx"));
const UserProductivity = lazy(() => import("./pages/UserProductivity.tsx"));
const Suppliers = lazy(() => import("./pages/Suppliers.tsx"));
const Items = lazy(() => import("./pages/Items.tsx"));
const RegistrationRequests = lazy(() => import("./pages/RegistrationRequests.tsx"));
const Intercompany = lazy(() => import("./pages/Intercompany.tsx"));
const FinancialReview = lazy(() => import("./pages/FinancialReview.tsx"));
const CashflowForecast = lazy(() => import("./pages/CashflowForecast.tsx"));
const AdvancePayments = lazy(() => import("./pages/AdvancePayments.tsx"));
const NfEntrada = lazy(() => import("./pages/NfEntrada.tsx"));
const AuditHub = lazy(() => import("./pages/AuditHub.tsx"));
const IntegrationsHub = lazy(() => import("./pages/IntegrationsHub.tsx"));
const Notifications = lazy(() => import("./pages/Notifications.tsx"));
const NotificationGovernance = lazy(() => import("./pages/NotificationGovernance.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Backoffice = lazy(() => import("./pages/Admin.tsx"));
const SapUsersReplicate = lazy(() => import("./pages/SapUsersReplicate.tsx"));
const AuditTrail = lazy(() => import("./pages/AuditTrail.tsx"));
const TransferApprovalsHistory = lazy(() => import("./pages/TransferApprovalsHistory.tsx"));
const SapStatusSync = lazy(() => import("./pages/SapStatusSync.tsx"));
const SapSyncRuns = lazy(() => import("./pages/SapSyncRuns.tsx"));
const BackofficeCopilot = lazy(() => import("./pages/BackofficeCopilot.tsx"));
const InfraHealth = lazy(() => import("./pages/InfraHealth.tsx"));
const DbPerformance = lazy(() => import("./pages/DbPerformance.tsx"));
const FlowPerformance = lazy(() => import("./pages/FlowPerformance.tsx"));
const IntegrationHealth = lazy(() => import("./pages/IntegrationHealth.tsx"));
const AuditTimeline = lazy(() => import("./pages/AuditTimeline.tsx"));
const AccessReview = lazy(() => import("./pages/AccessReview.tsx"));
const ApiKeys = lazy(() => import("./pages/ApiKeys.tsx"));
const SlaEscalation = lazy(() => import("./pages/SlaEscalation.tsx"));
const SlaDashboard = lazy(() => import("./pages/SlaDashboard.tsx"));
const BackofficeRetryQueue = lazy(() => import("./pages/BackofficeRetryQueue.tsx"));
const BackofficeRoadmap = lazy(() => import("./pages/BackofficeRoadmap.tsx"));
const PagCorpSettlementAudit = lazy(() => import("./pages/PagCorpSettlementAudit.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));


const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
  </div>
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
            <Suspense fallback={<RouteFallback />}>
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
              <Route path="/analytics" element={<ModuleRoute module="analytics"><AnalyticsPage /></ModuleRoute>} />

              {/* Operação */}
              <Route path="/compras" element={<ModuleRoute module="expenses"><Expenses /></ModuleRoute>} />
              <Route path="/vendas" element={<Navigate to="/vendas/pedidos" replace />} />
              <Route path="/vendas/pedidos" element={<ModuleRoute module="sales"><SalesHub tab="orders" /></ModuleRoute>} />
              <Route path="/vendas/nfse" element={<ModuleRoute module="sales"><SalesHub tab="nfse" /></ModuleRoute>} />
              <Route path="/vendas/adiantamentos" element={<ModuleRoute module="sales"><SalesHub tab="advances" /></ModuleRoute>} />
              <Route path="/vendas/recebimentos" element={<ModuleRoute module="sales"><SalesHub tab="receivables" /></ModuleRoute>} />
              <Route path="/vendas/destinatarios" element={<ModuleRoute module="sales"><SalesHub tab="recipients" /></ModuleRoute>} />
              <Route path="/vendas/historico" element={<ModuleRoute module="sales"><BaixasHistory /></ModuleRoute>} />

              {/* Aprovações */}
              <Route path="/aprovacoes" element={<ModuleRoute module="approvals"><ApprovalsHub /></ModuleRoute>} />
              <Route path="/aprovacoes/mobile" element={<ModuleRoute module="approvals"><MobileApprovals /></ModuleRoute>} />
              <Route path="/captura/nota" element={<ModuleRoute module="expenses"><MobileInvoiceCapture /></ModuleRoute>} />
              <Route path="/aprovacoes/regras" element={<ModuleRoute module="approval_rules"><ApprovalRules /></ModuleRoute>} />
              <Route path="/aprovacoes/matriz" element={<ModuleRoute module="approval_rules"><ApprovalMatrix /></ModuleRoute>} />


              {/* Cartões Corporativos */}
              <Route path="/cartoes" element={<Navigate to="/cartoes/transacoes" replace />} />
              <Route path="/cartoes/transacoes" element={<ModuleRoute module="pagcorp"><PagCorp /></ModuleRoute>} />
              <Route path="/cartoes/mapeamento" element={<ModuleRoute module="pagcorp"><PagCorpMapping /></ModuleRoute>} />
              <Route path="/cartoes/indedutiveis" element={<ModuleRoute module="pagcorp"><PagCorpNondeductible /></ModuleRoute>} />
              <Route path="/cartoes/baixas" element={<ModuleRoute module="pagcorp"><PagCorpSettlements /></ModuleRoute>} />
              <Route path="/cartoes/historico" element={<ModuleRoute module="pagcorp"><IntegrationHistory /></ModuleRoute>} />

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
              <Route path="/analytics/produtividade" element={<ModuleRoute module="users_productivity"><UserProductivity /></ModuleRoute>} />
              <Route path="/usuarios/sincronizacao-idp" element={<UsersHub tab="idp" />} />
              <Route path="/usuarios/licencas" element={<UsersHub tab="licenses" />} />
              <Route path="/usuarios/importar-licencas" element={<UsersHub tab="licenses-import" />} />

              {/* Cadastros */}
              <Route path="/cadastros/fornecedores" element={<ModuleRoute module="suppliers"><Suppliers /></ModuleRoute>} />
              
              <Route path="/cadastros/itens" element={<ModuleRoute module="items"><Items /></ModuleRoute>} />
              <Route path="/cadastros/solicitacoes" element={<Navigate to="/solicitacoes" replace />} />
              <Route path="/cadastros/intercompany" element={<ModuleRoute module="intercompany"><Intercompany /></ModuleRoute>} />

              {/* Solicitações de cadastro (módulo próprio) */}
              <Route path="/solicitacoes" element={<RegistrationRequests />} />

              {/* Financeiro */}
              <Route path="/financeiro/adiantamentos" element={<ModuleRoute module="financial_review"><AdvancePayments /></ModuleRoute>} />
              <Route path="/financeiro/reconciliacao" element={<ModuleRoute module="financial_review"><FinancialReview /></ModuleRoute>} />
              <Route path="/financeiro/previsao-caixa" element={<ModuleRoute module="financial_review"><CashflowForecast /></ModuleRoute>} />
              <Route path="/financeiro/nf-entrada" element={<ModuleRoute module="nf_entrada"><NfEntrada /></ModuleRoute>} />

              {/* Notificações */}
              <Route path="/notificacoes" element={<ModuleRoute module="notifications"><Notifications /></ModuleRoute>} />
              <Route path="/notificacoes/regras" element={<ModuleRoute module="notifications"><NotificationGovernance /></ModuleRoute>} />

              {/* Perfil intercompany */}
              <Route path="/perfil" element={<Profile />} />

              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
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
