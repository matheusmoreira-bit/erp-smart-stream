import { useNavigate, useLocation } from "react-router-dom";
import AuditConsole from "./AuditConsole";
import FiscalAudit from "./FiscalAudit";
import AuditLog from "./AuditLog";
import AuditCrossFiscal from "./AuditCrossFiscal";
import { useModuleAccess } from "@/hooks/usePermissions";
import { HubTabs } from "@/components/HubTabs";

type TabKey = "sap" | "fiscal" | "cruzamento" | "logs";

interface Props {
  tab: TabKey;
}

export default function AuditHub({ tab }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { userModules } = useModuleAccess();

  const allTabs = [
    { key: "sap" as const, label: "Auditoria SAP", module: "audit_console", path: "/auditoria/sap" },
    { key: "fiscal" as const, label: "Auditoria Fiscal", module: "fiscal_audit", path: "/auditoria/fiscal" },
    { key: "cruzamento" as const, label: "Cruzamento Fiscal × Pagamentos", module: "fiscal_audit", path: "/auditoria/cruzamento" },
    { key: "logs" as const, label: "Logs do Sistema", module: "audit_log", path: "/auditoria/logs" },
  ];

  const tabs = allTabs.filter(
    (t) => userModules.length === 0 || userModules.includes(t.module),
  );

  const handleChange = (key: string) => {
    const target = allTabs.find((t) => t.key === key);
    if (target) navigate(target.path);
  };

  let Body: JSX.Element;
  if (tab === "sap") Body = <AuditConsole />;
  else if (tab === "fiscal") Body = <FiscalAudit />;
  else if (tab === "cruzamento") Body = <AuditCrossFiscal />;
  else Body = <AuditLog />;

  return (
    <div>
      <HubTabs
        tabs={tabs.map((t) => ({ key: t.key, label: t.label }))}
        active={tab}
        onChange={handleChange}
      />
      {Body}
    </div>
  );
}

