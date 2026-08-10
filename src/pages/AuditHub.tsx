import AuditConsole from "./AuditConsole";
import FiscalAudit from "./FiscalAudit";
import AuditLog from "./AuditLog";
import AuditCrossFiscal from "./AuditCrossFiscal";
import AuditKYP from "./AuditKYP";
import SapTotalsReconciliation from "./SapTotalsReconciliation";
import { TabsHub, type HubTabDef } from "@/components/TabsHub";

type TabKey = "sap" | "fiscal" | "cruzamento" | "totais" | "kyp" | "logs";

const TABS: readonly HubTabDef<TabKey>[] = [
  { key: "sap", label: "Auditoria SAP", module: "audit_console", path: "/auditoria/sap", render: () => <AuditConsole /> },
  { key: "fiscal", label: "Auditoria Fiscal", module: "fiscal_audit", path: "/auditoria/fiscal", render: () => <FiscalAudit /> },
  { key: "cruzamento", label: "Cruzamento Fiscal × Pagamentos", module: "fiscal_audit", path: "/auditoria/cruzamento", render: () => <AuditCrossFiscal /> },
  { key: "totais", label: "Reconciliação de Totais", module: "fiscal_audit", path: "/auditoria/totais", render: () => <SapTotalsReconciliation /> },
  { key: "kyp", label: "KYP — Fornecedores", module: "kyp", path: "/auditoria/kyp", render: () => <AuditKYP /> },
  { key: "logs", label: "Logs do Sistema", module: "audit_log", path: "/auditoria/logs", render: () => <AuditLog /> },
];


export default function AuditHub({ tab }: { tab: TabKey }) {
  return <TabsHub tabs={TABS} active={tab} moduleLabel="Auditoria" />;
}
