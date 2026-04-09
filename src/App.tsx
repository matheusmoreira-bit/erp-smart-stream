import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SapProvider } from "@/contexts/SapContext";
import Index from "./pages/Index.tsx";
import AnalyticsPage from "./pages/Analytics.tsx";
import Approvals from "./pages/Approvals.tsx";
import NotFound from "./pages/NotFound.tsx";

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
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </SapProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
