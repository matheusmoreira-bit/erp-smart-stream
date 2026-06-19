import { useNavigate } from "react-router-dom";
import Users from "./Users";
import UserActivity from "./UserActivity";
import UserProductivity from "./UserProductivity";
import IdpSync from "./IdpSync";
import LicenseAnalysis from "./LicenseAnalysis";
import LicenseImport from "./LicenseImport";
import { useModuleAccess } from "@/hooks/usePermissions";
import { HubTabs } from "@/components/HubTabs";

type TabKey =
  | "list"
  | "activity"
  | "productivity"
  | "licenses"
  | "licenses-import"
  | "idp";

interface Props {
  tab: TabKey;
}

export default function UsersHub({ tab }: Props) {
  const navigate = useNavigate();
  const { userModules } = useModuleAccess();

  const allTabs = [
    { key: "list" as const, label: "Usuários", module: "users", path: "/usuarios/lista" },
    { key: "activity" as const, label: "Atividade", module: "users", path: "/usuarios/atividade" },
    { key: "productivity" as const, label: "Produtividade", module: "users_productivity", path: "/usuarios/produtividade" },
    { key: "licenses" as const, label: "Licenças", module: "users", path: "/usuarios/licencas" },
    { key: "licenses-import" as const, label: "Importar Licenças", module: "users", path: "/usuarios/importar-licencas" },
    { key: "idp" as const, label: "Sincronização IdP", module: "users", path: "/usuarios/sincronizacao-idp" },
  ];

  const tabs = allTabs.filter(
    (t) => userModules.length === 0 || userModules.includes(t.module),
  );

  const handleChange = (key: string) => {
    const target = allTabs.find((t) => t.key === key);
    if (target) navigate(target.path);
  };

  let Body: JSX.Element;
  if (tab === "activity") Body = <UserActivity />;
  else if (tab === "productivity") Body = <UserProductivity />;
  else if (tab === "licenses") Body = <LicenseAnalysis />;
  else if (tab === "licenses-import") Body = <LicenseImport />;
  else if (tab === "idp") Body = <IdpSync />;
  else Body = <Users />;

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
