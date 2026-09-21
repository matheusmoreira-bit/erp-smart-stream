import AuditUnified from "./AuditUnified";
import AuditLog from "./AuditLog";
import AuditCrossFiscal from "./AuditCrossFiscal";
import AuditKYP from "./AuditKYP";
import SapTotalsReconciliation from "./SapTotalsReconciliation";
import AuditTrail from "./AuditTrail";
import AuditTimeline from "./AuditTimeline";
import PagCorpSettlementAudit from "./PagCorpSettlementAudit";
import { TabsHub, type HubTabDef } from "@/components/TabsHub";

type TabKey =
  | "geral"
  | "cruzamento"
  | "totais"
  | "kyp"
  | "logs"
  | "trilha"
  | "documento"
  | "baixas";

const TABS: readonly HubTabDef<TabKey>[] = [
  { key: "geral", label: "Auditoria (SAP · Pagamentos · Fiscal)", module: "audit_console", path: "/auditoria/geral", render: () => <AuditUnified /> },

  { key: "cruzamento", label: "Cruzamento Fiscal × Pagamentos", module: "fiscal_audit", path: "/auditoria/cruzamento", render: () => <AuditCrossFiscal /> },
  { key: "totais", label: "Reconciliação de Totais", module: "fiscal_audit", path: "/auditoria/totais", render: () => <SapTotalsReconciliation /> },
  { key: "kyp", label: "KYP — Fornecedores", module: "kyp", path: "/auditoria/kyp", render: () => <AuditKYP /> },
  { key: "logs", label: "Logs do Sistema", module: "audit_log", path: "/auditoria/logs", render: () => <AuditLog /> },
  { key: "trilha", label: "Trilha de auditoria", module: "audit_log", path: "/auditoria/trilha", render: () => <AuditTrail embedded /> },
  { key: "documento", label: "Trilha por documento", module: "audit_log", path: "/auditoria/documento", render: () => <AuditTimeline embedded /> },
  { key: "baixas", label: "Baixas PagCorp", module: "pagcorp", path: "/auditoria/baixas-pagcorp", render: () => <PagCorpSettlementAudit embedded /> },
];


export default function AuditHub({ tab }: { tab: TabKey }) {
  return <TabsHub tabs={TABS} active={tab} moduleLabel="Auditoria" />;
}
