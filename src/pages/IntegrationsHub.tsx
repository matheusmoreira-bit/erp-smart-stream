import { useNavigate } from "react-router-dom";
import Synapse from "./Synapse";
import IntegrationsMonitor from "./IntegrationsMonitor";
import Credentials from "./Credentials";
import EmployeesIntegration from "./EmployeesIntegration";
import { useModuleAccess } from "@/hooks/usePermissions";
import { HubTabs } from "@/components/HubTabs";

type TabKey = "automations" | "monitor" | "credentials" | "employees";

interface Props {
  tab: TabKey;
}

export default function IntegrationsHub({ tab }: Props) {
  const navigate = useNavigate();
  const { userModules } = useModuleAccess();

  const allTabs = [
    { key: "automations" as const, label: "Automações", module: "synapse", path: "/integracoes/automacoes" },
    { key: "monitor" as const, label: "Monitor de Integrações", module: "integration_history", path: "/integracoes/monitor" },
    { key: "employees" as const, label: "Colaboradores", module: "employee_integration", path: "/integracoes/colaboradores" },
    { key: "credentials" as const, label: "Credenciais", module: "credentials", path: "/integracoes/credenciais" },
  ];

  const tabs = allTabs.filter(
    (t) => userModules.length === 0 || userModules.includes(t.module),
  );

  const handleChange = (key: string) => {
    const target = allTabs.find((t) => t.key === key);
    if (target) navigate(target.path);
  };

  let Body: JSX.Element;
  if (tab === "monitor") Body = <IntegrationsMonitor />;
  else if (tab === "credentials") Body = <Credentials />;
  else if (tab === "employees") Body = <EmployeesIntegration />;
  else Body = <Synapse />;

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
