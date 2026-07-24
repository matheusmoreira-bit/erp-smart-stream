import Users from "./Users";
import UserActivity from "./UserActivity";
import UserProductivity from "./UserProductivity";
import IdpSync from "./IdpSync";
import LicenseAnalysis from "./LicenseAnalysis";
import LicenseImport from "./LicenseImport";
import { TabsHub, type HubTabDef } from "@/components/TabsHub";

type TabKey =
  | "list"
  | "activity"
  | "productivity"
  | "licenses"
  | "licenses-import"
  | "idp";

const TABS: readonly HubTabDef<TabKey>[] = [
  { key: "list", label: "Usuários", module: "users", path: "/usuarios/lista", render: () => <Users /> },
  { key: "activity", label: "Atividade", module: "users", path: "/usuarios/atividade", render: () => <UserActivity /> },
  { key: "productivity", label: "Produtividade", module: "users_productivity", path: "/usuarios/produtividade", render: () => <UserProductivity /> },
  { key: "licenses", label: "Licenças", module: "users", path: "/usuarios/licencas", render: () => <LicenseAnalysis /> },
  { key: "licenses-import", label: "Importar Licenças", module: "users", path: "/usuarios/importar-licencas", render: () => <LicenseImport /> },
  { key: "idp", label: "Sincronização IdP", module: "users", path: "/usuarios/sincronizacao-idp", render: () => <IdpSync /> },
];

export default function UsersHub({ tab }: { tab: TabKey }) {
  return <TabsHub tabs={TABS} active={tab} />;
}
