import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, LayoutDashboard, ListChecks, Settings2, ShieldAlert, Wallet } from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { useModuleAccess } from "@/hooks/usePermissions";
import { useCompanies } from "@/hooks/useCompanies";
import { PageTitle } from "@/components/PageTitle";
import { PayAuditDashboard } from "@/components/audit-pay/PayAuditDashboard";
import { PayAuditQueue } from "@/components/audit-pay/PayAuditQueue";
import { PayAuditResults } from "@/components/audit-pay/PayAuditResults";
import { PayAuditDetail } from "@/components/audit-pay/PayAuditDetail";
import { PayFraudSignals } from "@/components/audit-pay/PayFraudSignals";
import { PayAuditConfig } from "@/components/audit-pay/PayAuditConfig";

const subNav = [
  { to: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "results", label: "Resultados", icon: AlertTriangle },
  { to: "queue", label: "Fila", icon: ListChecks },
  { to: "signals", label: "Sinais de fraude", icon: ShieldAlert },
  { to: "config", label: "Configurações", icon: Settings2 },
];

export default function AuditPayments() {
  const { session } = useSap();
  const { hasAccess, loading } = useModuleAccess("audit_console");
  const { getLabel } = useCompanies(true);
  const location = useLocation();

  if (!session) return <Navigate to="/" replace />;
  if (loading) return null;
  if (!hasAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">Sem acesso à Auditoria de Pagamentos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Solicite ao administrador o módulo <code>audit_console</code>.
          </p>
          <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">Voltar ao menu</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Auditoria de Pagamentos" />
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-2 sm:gap-3">
          <Link to="/analytics" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <div className="shrink-0 rounded-lg bg-primary/10 p-2">
              <Wallet className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold text-foreground sm:text-lg">Auditoria de Pagamentos</h1>
              <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground sm:text-[11px]">
                {getLabel(session.companyDB || "")}
              </p>
            </div>
          </div>
        </div>
        <nav className="-mx-4 mt-3 flex snap-x items-center gap-1.5 overflow-x-auto px-4 scrollbar-none md:hidden">
          {subNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive ? "border border-primary/30 bg-primary/15 text-primary" : "border border-transparent bg-muted/40 text-muted-foreground"
                  }`
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-4 sm:px-6 sm:py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="space-y-1">
            {subNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<PayAuditDashboard />} />
              <Route path="results" element={<PayAuditResults />} />
              <Route path="results/:resultId" element={<PayAuditDetail />} />
              <Route path="queue" element={<PayAuditQueue />} />
              <Route path="signals" element={<PayFraudSignals />} />
              <Route path="config" element={<PayAuditConfig />} />
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
