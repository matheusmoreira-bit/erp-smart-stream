import UsersPage from "./Users";
import UserActivity from "./UserActivity";
import IdpSync from "./IdpSync";
import LicenseAnalysis from "./LicenseAnalysis";
import LicenseImport from "./LicenseImport";
import UsersPermissions from "./UsersPermissions";
import { TabsHub, type HubTabDef } from "@/components/TabsHub";

type TabKey = "list" | "permissions" | "idp" | "activity" | "licenses" | "licenses-import";

/**
 * Acesso & Usuários.
 * "Administradores" e "Usuários SAP" deixaram de ser abas — viraram segmentos
 * da lista canônica (`/usuarios/lista?seg=admins|sap`). "Produtividade" saiu
 * da seção (mora em Analytics).
 */
const TABS: readonly HubTabDef<TabKey>[] = [
  { key: "list", label: "Usuários", module: "users", path: "/usuarios/lista", render: () => <UsersPage embedded /> },
  { key: "permissions", label: "Grupos & Permissões", module: "users", path: "/usuarios/permissoes", render: () => <UsersPermissions /> },
  { key: "idp", label: "Sincronização IdP", module: "users", path: "/usuarios/sincronizacao-idp", render: () => <IdpSync /> },
  { key: "activity", label: "Atividade & Auditoria", module: "users", path: "/usuarios/atividade", render: () => <UserActivity /> },
  { key: "licenses", label: "Licenças", module: "users", path: "/usuarios/licencas", render: () => <LicenseAnalysis /> },
  { key: "licenses-import", label: "Importar", module: "users", path: "/usuarios/importar-licencas", render: () => <LicenseImport /> },
];

export default function UsersHub({ tab }: { tab: TabKey }) {
  return <TabsHub tabs={TABS} active={tab} moduleLabel="Acesso & Usuários" />;
}
