import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  FileSearch,
  LayoutDashboard,
  ListChecks,
  Radar,
  Receipt,
  ScrollText,
  Settings2,
  ShieldAlert,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useSap } from "@/contexts/SapContext";
import { useModuleAccess } from "@/hooks/usePermissions";
import { PageTitle } from "@/components/PageTitle";
import { AuditDashboard } from "@/components/audit-console/AuditDashboard";
import { AuditRunsList } from "@/components/audit-console/AuditRunsList";
import { AuditRunDetail } from "@/components/audit-console/AuditRunDetail";
import { AuditDivergencesTable } from "@/components/audit-console/AuditDivergencesTable";
import { AuditRulesTable } from "@/components/audit-console/AuditRulesTable";
import { AuditLogsViewer } from "@/components/audit-console/AuditLogsViewer";
import { AuditInsightsList } from "@/components/audit-console/AuditInsightsList";
import { AuditDocumentsTab } from "@/components/audit-console/AuditDocumentsTab";
import { PayAuditDashboard } from "@/components/audit-pay/PayAuditDashboard";
import { PayAuditQueue } from "@/components/audit-pay/PayAuditQueue";
import { PayAuditResults } from "@/components/audit-pay/PayAuditResults";
import { PayAuditDetail } from "@/components/audit-pay/PayAuditDetail";
import { PayFraudSignals } from "@/components/audit-pay/PayFraudSignals";
import { PayAuditConfig } from "@/components/audit-pay/PayAuditConfig";
import FiscalAudit from "./FiscalAudit";

export const AUDIT_BASE = "/auditoria/geral";

type SectionKey =
  | "sap-dashboard"
  | "sap-runs"
  | "sap-divergences"
  | "sap-documents"
  | "sap-insights"
  | "sap-rules"
  | "sap-logs"
  | "pay-dashboard"
  | "pay-results"
  | "pay-queue"
  | "pay-signals"
  | "pay-config"
  | "fiscal";

interface SectionDef {
  key: SectionKey;
  label: string;
  icon: typeof Radar;
  module?: string;
  render: (id?: string) => JSX.Element;
}

interface GroupDef {
  label: string;
  items: SectionDef[];
}

const GROUPS: GroupDef[] = [
  {
    label: "Auditoria SAP",
    items: [
      { key: "sap-dashboard", label: "Dashboard", icon: LayoutDashboard, module: "audit_console", render: () => <AuditDashboard /> },
      {
        key: "sap-runs",
        label: "Auditorias",
        icon: Radar,
        module: "audit_console",
        render: (id) => (id ? <AuditRunDetail runId={id} /> : <AuditRunsList />),
      },
      { key: "sap-divergences", label: "Divergências", icon: AlertTriangle, module: "audit_console", render: () => <AuditDivergencesTable /> },
      { key: "sap-documents", label: "Documentos", icon: FileSearch, module: "audit_console", render: () => <AuditDocumentsTab /> },
      { key: "sap-insights", label: "Insights IA", icon: Sparkles, module: "audit_console", render: () => <AuditInsightsList /> },
      { key: "sap-rules", label: "Regras", icon: ListChecks, module: "audit_console", render: () => <AuditRulesTable /> },
      { key: "sap-logs", label: "Logs", icon: ScrollText, module: "audit_console", render: () => <AuditLogsViewer /> },
    ],
  },
  {
    label: "Auditoria de Pagamentos",
    items: [
      { key: "pay-dashboard", label: "Dashboard", icon: Wallet, module: "audit_console", render: () => <PayAuditDashboard /> },
      {
        key: "pay-results",
        label: "Resultados",
        icon: AlertTriangle,
        module: "audit_console",
        render: (id) => (id ? <PayAuditDetail resultId={id} /> : <PayAuditResults />),
      },
      { key: "pay-queue", label: "Fila", icon: ListChecks, module: "audit_console", render: () => <PayAuditQueue /> },
      { key: "pay-signals", label: "Sinais de fraude", icon: ShieldAlert, module: "audit_console", render: () => <PayFraudSignals /> },
      { key: "pay-config", label: "Configurações", icon: Settings2, module: "audit_console", render: () => <PayAuditConfig /> },
    ],
  },
  {
    label: "Auditoria Fiscal",
    items: [
      { key: "fiscal", label: "Notas fiscais", icon: Receipt, module: "fiscal_audit", render: () => <FiscalAudit embedded /> },
    ],
  },
];

const ALL_SECTIONS = GROUPS.flatMap((g) => g.items);

export default function AuditUnified() {
  const { session } = useSap();
  const navigate = useNavigate();
  const { section, id } = useParams<{ section?: string; id?: string }>();
  const { hasAccess: hasSap, loading: loadingSap } = useModuleAccess("audit_console");
  const { hasAccess: hasFiscal, loading: loadingFiscal } = useModuleAccess("fiscal_audit");

  if (!session) return <Navigate to="/" replace />;
  if (loadingSap || loadingFiscal) return null;

  const can = (mod?: string) => (mod === "fiscal_audit" ? hasFiscal : mod === "audit_console" ? hasSap : true);
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => can(i.module)) })).filter(
    (g) => g.items.length > 0,
  );

  if (groups.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">Sem acesso ao módulo de Auditoria</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Solicite ao administrador os módulos <code>audit_console</code> ou <code>fiscal_audit</code>.
          </p>
          <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">
            Voltar ao menu
          </Link>
        </div>
      </div>
    );
  }

  const available = groups.flatMap((g) => g.items);
  const active =
    available.find((s) => s.key === section) ??
    ALL_SECTIONS.find((s) => s.key === section && can(s.module)) ??
    available[0];

  const go = (key: SectionKey) => navigate(`${AUDIT_BASE}/${key}`);

  return (
    <div className="bg-background">
      <PageTitle title="Auditoria" />

      {/* Mobile section pills */}
      <nav className="md:hidden flex snap-x items-center gap-1.5 overflow-x-auto px-4 py-3 scrollbar-none">
        {available.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => go(item.key)}
              className={`flex shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "border border-primary/30 bg-primary/15 text-primary"
                  : "border border-transparent bg-muted/40 text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-4 sm:px-6 sm:py-6">
        <aside className="hidden w-60 shrink-0 md:block">
          <nav className="space-y-5">
            {groups.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.key === active.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => go(item.key)}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <motion.div
            key={`${active.key}:${id ?? ""}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {active.render(id)}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
