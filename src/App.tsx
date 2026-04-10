import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SapProvider } from "@/contexts/SapContext";
import Index from "./pages/Index.tsx";
import AnalyticsPage from "./pages/Analytics.tsx";
import Approvals from "./pages/Approvals.tsx";
import Expenses from "./pages/Expenses.tsx";
import ApprovalRules from "./pages/ApprovalRules.tsx";
import PagCorp from "./pages/PagCorp.tsx";
import PagCorpMapping from "./pages/PagCorpMapping.tsx";
import IntegrationHistory from "./pages/IntegrationHistory.tsx";
import Credentials from "./pages/Credentials.tsx";
import UsersPage from "./pages/Users.tsx";
import UserActivity from "./pages/UserActivity.tsx";
import IdpSync from "./pages/IdpSync.tsx";
import Synapse from "./pages/Synapse.tsx";
import NotFound from "./pages/NotFound.tsx";
import AdminLogin from "./pages/AdminLogin.tsx";
import Admin from "./pages/Admin.tsx";
import { AdminRoute } from "./components/AdminRoute.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <SapProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/approval-rules" element={<ApprovalRules />} />
            <Route path="/pagcorp" element={<PagCorp />} />
            <Route path="/pagcorp/mapping" element={<PagCorpMapping />} />
            <Route path="/pagcorp/history" element={<IntegrationHistory />} />
            <Route path="/credentials" element={<Credentials />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/activity" element={<UserActivity />} />
            <Route path="/users/idp-sync" element={<IdpSync />} />
            <Route path="/synapse" element={<Synapse />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </SapProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
