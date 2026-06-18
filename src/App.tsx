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
import { AdminRoute } from "./components/AdminRoute.tsx";
import { GlobalAiChat } from "./components/GlobalAiChat.tsx";
import { StickyHeaderMeasure } from "./components/StickyHeaderMeasure.tsx";

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
              <Route path="/backoffice/login" element={<BackofficeLogin />} />
              <Route path="/backoffice" element={<AdminRoute><Backoffice /></AdminRoute>} />
              <Route path="/backoffice/sap-users" element={<AdminRoute><SapUsersAdmin /></AdminRoute>} />
              <Route path="/backoffice/sap-users/replicate" element={<AdminRoute><SapUsersReplicate /></AdminRoute>} />
              <Route path="/analytics" element={<AnalyticsPage />} />

              {/* Auditoria — hub */}
              <Route path="/auditoria" element={<Navigate to="/auditoria/sap" replace />} />
              <Route path="/auditoria/sap/*" element={<AuditHub tab="sap" />} />
              <Route path="/auditoria/fiscal" element={<AuditHub tab="fiscal" />} />
              <Route path="/auditoria/logs" element={<AuditHub tab="logs" />} />
              {/* Legacy redirects → Auditoria */}
              <Route path="/analytics/audit" element={<Navigate to="/auditoria/sap" replace />} />
              <Route path="/analytics/audit/*" element={<Navigate to="/auditoria/sap" replace />} />
              <Route path="/fiscal-audit" element={<Navigate to="/auditoria/fiscal" replace />} />
              <Route path="/audit-log" element={<Navigate to="/auditoria/logs" replace />} />

              {/* Aprovações — hub */}
              <Route path="/approvals" element={<ApprovalsHub />} />
              <Route path="/approvals/history" element={<Navigate to="/approvals?tab=history" replace />} />

              <Route path="/expenses" element={<Expenses />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/approval-rules" element={<ApprovalRules />} />
              <Route path="/pagcorp" element={<PagCorp />} />
              <Route path="/pagcorp/mapping" element={<PagCorpMapping />} />
              <Route path="/pagcorp/nondeductible" element={<PagCorpNondeductible />} />
              <Route path="/pagcorp/history" element={<IntegrationHistory />} />

              {/* Integrações — hub */}
              <Route path="/integracoes" element={<Navigate to="/integracoes/automacoes" replace />} />
              <Route path="/integracoes/automacoes" element={<IntegrationsHub tab="automations" />} />
              <Route path="/integracoes/monitor" element={<IntegrationsHub tab="monitor" />} />
              <Route path="/integracoes/credenciais" element={<IntegrationsHub tab="credentials" />} />
              {/* Legacy redirects → Integrações */}
              <Route path="/synapse" element={<Navigate to="/integracoes/automacoes" replace />} />
              <Route path="/integrations/monitor" element={<Navigate to="/integracoes/monitor" replace />} />
              <Route path="/credentials" element={<Navigate to="/integracoes/credenciais" replace />} />

              {/* Usuários — hub (rotas legadas preservadas, agora servidas pelo hub) */}
              <Route path="/users" element={<UsersHub tab="list" />} />
              <Route path="/users/activity" element={<UsersHub tab="activity" />} />
              <Route path="/users/productivity" element={<UsersHub tab="productivity" />} />
              <Route path="/users/idp-sync" element={<UsersHub tab="idp" />} />
              <Route path="/users/license-analysis" element={<UsersHub tab="licenses" />} />
              <Route path="/users/license-import" element={<UsersHub tab="licenses-import" />} />

              <Route path="/suppliers" element={<Suppliers />} />
              <Route path="/suppliers/import-pagcorp" element={<SuppliersImportPagCorp />} />
              <Route path="/items" element={<Items />} />
              <Route path="/cadastros/itens" element={<Navigate to="/items" replace />} />
              <Route path="/cadastros/fornecedores" element={<Navigate to="/suppliers" replace />} />
              <Route path="/intercompany" element={<Intercompany />} />
              <Route path="/financial-review" element={<FinancialReview />} />
              <Route path="/advance-payments" element={<AdvancePayments />} />
              <Route path="/nf-entrada" element={<NfEntrada />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
          <GlobalAiChat />
        </SapProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
