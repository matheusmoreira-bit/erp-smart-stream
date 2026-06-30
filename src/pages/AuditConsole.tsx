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
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/analytics"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Analytics
            </Link>
            <span className="text-muted-foreground">/</span>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/10 p-2">
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">Auditoria SAP</h1>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {getLabel(session.companyDB || "")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
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
              <Route
                path="documents"
                element={
                  <ComingSoon
                    title="Análise documental"
                    description="Upload e confronto de NFs / contratos contra os dados do SAP via IA. Fase 4."
                  />
                }
              />
              <Route
                path="insights"
                element={
                  <ComingSoon
                    title="Insights gerados pela IA"
                    description="Resumo executivo das anomalias mais relevantes da última auditoria. Fase 3."
                  />
                }
              />
              <Route
                path="rules"
                element={
                  <ComingSoon
                    title="Regras de divergência"
                    description="Configure tolerâncias, severidades padrão e regras customizadas por empresa. Fase 3."
                  />
                }
              />
              <Route
                path="logs"
                element={
                  <ComingSoon
                    title="Logs operacionais"
                    description="Trace detalhado da execução de cada run do motor de auditoria. Fase 3."
                  />
                }
              />
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
