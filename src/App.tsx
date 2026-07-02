import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SapProvider } from "@/contexts/SapContext";
import Index from "./pages/Index.tsx";
import AnalyticsPage from "./pages/Analytics.tsx";
import ApprovalsHub from "./pages/ApprovalsHub.tsx";
import Expenses from "./pages/Expenses.tsx";
import Sales from "./pages/Sales.tsx";
import ApprovalRules from "./pages/ApprovalRules.tsx";
import PagCorp from "./pages/PagCorp.tsx";
import PagCorpMapping from "./pages/PagCorpMapping.tsx";
import PagCorpNondeductible from "./pages/PagCorpNondeductible.tsx";
import IntegrationHistory from "./pages/IntegrationHistory.tsx";
import UsersHub from "./pages/UsersHub.tsx";
import Suppliers from "./pages/Suppliers.tsx";
import Items from "./pages/Items.tsx";
import Intercompany from "./pages/Intercompany.tsx";
import FinancialReview from "./pages/FinancialReview.tsx";
import AdvancePayments from "./pages/AdvancePayments.tsx";
import NfEntrada from "./pages/NfEntrada.tsx";
import SuppliersImportPagCorp from "./pages/SuppliersImportPagCorp.tsx";
import AuditHub from "./pages/AuditHub.tsx";
import IntegrationsHub from "./pages/IntegrationsHub.tsx";
import Notifications from "./pages/Notifications.tsx";
import NotFound from "./pages/NotFound.tsx";
import BackofficeLogin from "./pages/AdminLogin.tsx";
import Backoffice from "./pages/Admin.tsx";
import SapUsersAdmin from "./pages/SapUsersAdmin.tsx";
import SapUsersReplicate from "./pages/SapUsersReplicate.tsx";
import AuditTrail from "./pages/AuditTrail.tsx";
import { AdminRoute } from "./components/AdminRoute.tsx";
import { GlobalAiChat } from "./components/GlobalAiChat.tsx";
import { StickyHeaderMeasure } from "./components/StickyHeaderMeasure.tsx";
import { TestCompanyBanner } from "./components/TestCompanyBanner.tsx";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="erp-theme">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SapProvider>
          <BrowserRouter>
            <StickyHeaderMeasure />
            <Routes>
              <Route path="/" element={<Index />} />

              {/* Backoffice */}
              <Route path="/backoffice/login" element={<BackofficeLogin />} />
              <Route path="/backoffice" element={<AdminRoute><Backoffice /></AdminRoute>} />
              <Route path="/backoffice/sap-users" element={<AdminRoute><SapUsersAdmin /></AdminRoute>} />
              <Route path="/backoffice/sap-users/replicate" element={<AdminRoute><SapUsersReplicate /></AdminRoute>} />

              {/* Analytics */}
              <Route path="/analytics" element={<AnalyticsPage />} />

              {/* Operação */}
              <Route path="/compras" element={<Expenses />} />
              <Route path="/vendas" element={<Sales />} />

              {/* Aprovações */}
              <Route path="/aprovacoes" element={<ApprovalsHub />} />
              <Route path="/aprovacoes/regras" element={<ApprovalRules />} />

              {/* Cartões Corporativos */}
              <Route path="/cartoes" element={<Navigate to="/cartoes/transacoes" replace />} />
              <Route path="/cartoes/transacoes" element={<PagCorp />} />
              <Route path="/cartoes/mapeamento" element={<PagCorpMapping />} />
              <Route path="/cartoes/indedutiveis" element={<PagCorpNondeductible />} />
              <Route path="/cartoes/historico" element={<IntegrationHistory />} />

              {/* Auditoria */}
              <Route path="/auditoria" element={<Navigate to="/auditoria/sap" replace />} />
              <Route path="/auditoria/sap/*" element={<AuditHub tab="sap" />} />
              <Route path="/auditoria/fiscal" element={<AuditHub tab="fiscal" />} />
              <Route path="/auditoria/logs" element={<AuditHub tab="logs" />} />

              {/* Integrações */}
              <Route path="/integracoes" element={<Navigate to="/integracoes/automacoes" replace />} />
              <Route path="/integracoes/automacoes" element={<IntegrationsHub tab="automations" />} />
              <Route path="/integracoes/monitor" element={<IntegrationsHub tab="monitor" />} />
              <Route path="/integracoes/credenciais" element={<IntegrationsHub tab="credentials" />} />

              {/* Usuários */}
              <Route path="/usuarios" element={<Navigate to="/usuarios/lista" replace />} />
              <Route path="/usuarios/lista" element={<UsersHub tab="list" />} />
              <Route path="/usuarios/atividade" element={<UsersHub tab="activity" />} />
              <Route path="/usuarios/produtividade" element={<UsersHub tab="productivity" />} />
              <Route path="/usuarios/sincronizacao-idp" element={<UsersHub tab="idp" />} />
              <Route path="/usuarios/licencas" element={<UsersHub tab="licenses" />} />
              <Route path="/usuarios/importar-licencas" element={<UsersHub tab="licenses-import" />} />

              {/* Cadastros */}
              <Route path="/cadastros/fornecedores" element={<Suppliers />} />
              <Route path="/cadastros/fornecedores/importar-cartoes" element={<SuppliersImportPagCorp />} />
              <Route path="/cadastros/itens" element={<Items />} />
              <Route path="/cadastros/intercompany" element={<Intercompany />} />

              {/* Financeiro */}
              <Route path="/financeiro/adiantamentos" element={<AdvancePayments />} />
              <Route path="/financeiro/reconciliacao" element={<FinancialReview />} />
              <Route path="/financeiro/nf-entrada" element={<NfEntrada />} />

              {/* Notificações */}
              <Route path="/notificacoes" element={<Notifications />} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
          <TestCompanyBanner />
          <GlobalAiChat />
        </SapProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
