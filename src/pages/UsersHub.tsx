import UsersPage from "./Users";
import UserActivity from "./UserActivity";
import UserProductivity from "./UserProductivity";
import IdpSync from "./IdpSync";
import LicenseAnalysis from "./LicenseAnalysis";
import LicenseImport from "./LicenseImport";
import UsersPermissions from "./UsersPermissions";
import UsersAdmins from "./UsersAdmins";
import SapUsersAdmin from "./SapUsersAdmin";
import { TabsHub, type HubTabDef } from "@/components/TabsHub";

type TabKey =
  | "list"
  | "permissions"
  | "admins"
  | "sap"
  | "activity"
  | "productivity"
  | "licenses"
  | "licenses-import"
  | "idp";

const TABS: readonly HubTabDef<TabKey>[] = [
  { key: "list", label: "Gestão de usuários", module: "users", path: "/usuarios/lista", render: () => <UsersPage embedded /> },
  { key: "permissions", label: "Permissões e grupos", module: "users", path: "/usuarios/permissoes", render: () => <UsersPermissions /> },
  { key: "admins", label: "Administradores", module: "users", path: "/usuarios/administradores", render: () => <UsersAdmins /> },
  { key: "sap", label: "Usuários SAP", module: "users", path: "/usuarios/sap", render: () => <SapUsersAdmin /> },
  { key: "idp", label: "Sincronização IdP", module: "users", path: "/usuarios/sincronizacao-idp", render: () => <IdpSync /> },
  { key: "activity", label: "Atividade", module: "users", path: "/usuarios/atividade", render: () => <UserActivity /> },
  { key: "productivity", label: "Produtividade", module: "users_productivity", path: "/usuarios/produtividade", render: () => <UserProductivity /> },
  { key: "licenses", label: "Licenças", module: "users", path: "/usuarios/licencas", render: () => <LicenseAnalysis /> },
  { key: "licenses-import", label: "Importar Licenças", module: "users", path: "/usuarios/importar-licencas", render: () => <LicenseImport /> },
];

export default function UsersHub({ tab }: { tab: TabKey }) {
  return <TabsHub tabs={TABS} active={tab} moduleLabel="Usuários" />;
}
