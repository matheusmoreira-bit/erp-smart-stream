import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SapProvider } from "@/contexts/SapContext";
import Index from "./pages/Index.tsx";
import AnalyticsPage from "./pages/Analytics.tsx";
import Approvals from "./pages/Approvals.tsx";
import ApprovalHistory from "./pages/ApprovalHistory.tsx";
import Expenses from "./pages/Expenses.tsx";
import Sales from "./pages/Sales.tsx";
import ApprovalRules from "./pages/ApprovalRules.tsx";
import PagCorp from "./pages/PagCorp.tsx";
import PagCorpMapping from "./pages/PagCorpMapping.tsx";
import PagCorpNondeductible from "./pages/PagCorpNondeductible.tsx";
import IntegrationHistory from "./pages/IntegrationHistory.tsx";
import IntegrationsMonitor from "./pages/IntegrationsMonitor.tsx";
import Credentials from "./pages/Credentials.tsx";
import UsersPage from "./pages/Users.tsx";
import Suppliers from "./pages/Suppliers.tsx";
import Items from "./pages/Items.tsx";
import CadastroItens from "./pages/CadastroItens.tsx";
import CadastroFornecedores from "./pages/CadastroFornecedores.tsx";
import Intercompany from "./pages/Intercompany.tsx";
import FinancialReview from "./pages/FinancialReview.tsx";
import FiscalAudit from "./pages/FiscalAudit.tsx";
import NfEntrada from "./pages/NfEntrada.tsx";
import SuppliersImportPagCorp from "./pages/SuppliersImportPagCorp.tsx";
import UserActivity from "./pages/UserActivity.tsx";
import UserProductivity from "./pages/UserProductivity.tsx";
import IdpSync from "./pages/IdpSync.tsx";
import LicenseAnalysis from "./pages/LicenseAnalysis.tsx";
import LicenseImport from "./pages/LicenseImport.tsx";
import Synapse from "./pages/Synapse.tsx";
import AuditLog from "./pages/AuditLog.tsx";
import Notifications from "./pages/Notifications.tsx";
import AuditConsole from "./pages/AuditConsole.tsx";
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
              <Route path="/analytics/audit/*" element={<AuditConsole />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/approvals/history" element={<ApprovalHistory />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/approval-rules" element={<ApprovalRules />} />
              <Route path="/pagcorp" element={<PagCorp />} />
              <Route path="/pagcorp/mapping" element={<PagCorpMapping />} />
              <Route path="/pagcorp/nondeductible" element={<PagCorpNondeductible />} />
              <Route path="/pagcorp/history" element={<IntegrationHistory />} />
              <Route path="/integrations/monitor" element={<IntegrationsMonitor />} />
              <Route path="/credentials" element={<Credentials />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/suppliers" element={<Suppliers />} />
              <Route path="/suppliers/import-pagcorp" element={<SuppliersImportPagCorp />} />
              <Route path="/items" element={<Items />} />
              <Route path="/intercompany" element={<Intercompany />} />
              <Route path="/financial-review" element={<FinancialReview />} />
              <Route path="/fiscal-audit" element={<FiscalAudit />} />
              <Route path="/nf-entrada" element={<NfEntrada />} />
              <Route path="/users/activity" element={<UserActivity />} />
              <Route path="/users/productivity" element={<UserProductivity />} />
              <Route path="/users/idp-sync" element={<IdpSync />} />
              <Route path="/users/license-analysis" element={<LicenseAnalysis />} />
              <Route path="/users/license-import" element={<LicenseImport />} />
              <Route path="/synapse" element={<Synapse />} />
              <Route path="/audit-log" element={<AuditLog />} />
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
