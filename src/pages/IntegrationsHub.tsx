import Synapse from "./Synapse";
import IntegrationsMonitor from "./IntegrationsMonitor";
import Credentials from "./Credentials";
import EmployeesIntegration from "./EmployeesIntegration";
import { TabsHub, type HubTabDef } from "@/components/TabsHub";

type TabKey = "automations" | "monitor" | "credentials" | "employees";

const TABS: readonly HubTabDef<TabKey>[] = [
  { key: "automations", label: "Automações", module: "synapse", path: "/integracoes/automacoes", render: () => <Synapse /> },
  { key: "monitor", label: "Monitor de Integrações", module: "integration_history", path: "/integracoes/monitor", render: () => <IntegrationsMonitor /> },
  { key: "employees", label: "Colaboradores", module: "employee_integration", path: "/integracoes/colaboradores", render: () => <EmployeesIntegration /> },
  { key: "credentials", label: "Credenciais", module: "credentials", path: "/integracoes/credenciais", render: () => <Credentials /> },
];

export default function IntegrationsHub({ tab }: { tab: TabKey }) {
  return <TabsHub tabs={TABS} active={tab} moduleLabel="Integrações" />;
}
