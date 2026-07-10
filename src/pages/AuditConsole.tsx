import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  FileSearch,
  LayoutDashboard,
  ListChecks,
  Radar,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { useModuleAccess } from "@/hooks/usePermissions";
import { useCompanies } from "@/hooks/useCompanies";
import { AuditDashboard } from "@/components/audit-console/AuditDashboard";
import { AuditRunsList } from "@/components/audit-console/AuditRunsList";
import { AuditRunDetail } from "@/components/audit-console/AuditRunDetail";
import { AuditDivergencesTable } from "@/components/audit-console/AuditDivergencesTable";
import { AuditRulesTable } from "@/components/audit-console/AuditRulesTable";
import { AuditLogsViewer } from "@/components/audit-console/AuditLogsViewer";
import { AuditInsightsList } from "@/components/audit-console/AuditInsightsList";
import { AuditDocumentsTab } from "@/components/audit-console/AuditDocumentsTab";
import { PageTitle } from "@/components/PageTitle";

const subNav = [
  { to: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "runs", label: "Auditorias", icon: Radar },
  { to: "divergences", label: "Divergências", icon: AlertTriangle },
  { to: "documents", label: "Documentos", icon: FileSearch },
  { to: "insights", label: "Insights IA", icon: Sparkles },
  { to: "rules", label: "Regras", icon: ListChecks },
  { to: "logs", label: "Logs", icon: ScrollText },
];

export default function AuditConsole() {
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
          <p className="text-lg font-semibold text-foreground">Sem acesso ao Console de Auditoria</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Solicite ao administrador o módulo <code>audit_console</code>.
          </p>
          <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">
            Voltar ao menu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Auditoria" />
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 sm:px-6 py-3 sm:py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              to="/analytics"
              className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Analytics
            </Link>
            <Link
              to="/analytics"
              className="sm:hidden text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="hidden sm:inline text-muted-foreground">/</span>
            <div className="flex items-center gap-2 min-w-0">
              <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold text-foreground truncate">Auditoria SAP</h1>
                <p className="text-[10px] sm:text-[11px] uppercase tracking-wider text-muted-foreground truncate">
                  {getLabel(session.companyDB || "")}
                </p>
              </div>
            </div>
          </div>
        </div>
        {/* Mobile sub-nav pills */}
        <nav className="md:hidden -mx-4 mt-3 flex items-center gap-1.5 overflow-x-auto scrollbar-none px-4 snap-x">
          {subNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground bg-muted/40 border border-transparent"
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

      <div className="mx-auto flex max-w-7xl gap-6 px-4 sm:px-6 py-4 sm:py-6">
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
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
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
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<AuditDashboard />} />
              <Route path="runs" element={<AuditRunsList />} />
              <Route path="runs/:runId" element={<AuditRunDetail />} />
              <Route path="divergences" element={<AuditDivergencesTable />} />
              <Route path="documents" element={<AuditDocumentsTab />} />
              <Route path="insights" element={<AuditInsightsList />} />
              <Route path="rules" element={<AuditRulesTable />} />
              <Route path="logs" element={<AuditLogsViewer />} />
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
