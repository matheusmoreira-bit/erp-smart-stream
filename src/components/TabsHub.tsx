import { useNavigate } from "react-router-dom";
import { SubmenuBar } from "@/components/SubmenuBar";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { useModuleAccess } from "@/hooks/usePermissions";

export interface HubTabDef<K extends string> {
  key: K;
  label: string;
  module: string;
  path: string;
  render: () => JSX.Element;
}

interface TabsHubProps<K extends string> {
  tabs: readonly HubTabDef<K>[];
  active: K;
  moduleLabel?: string;
}

/**
 * Shared layout for hub pages (Auditoria, Integrações, Usuários).
 * Renderiza a própria régua de submódulos (não depende do submenu global,
 * que pode não encontrar o host em algumas telas).
 */
export function TabsHub<K extends string>({ tabs, active, moduleLabel }: TabsHubProps<K>) {
  const navigate = useNavigate();
  const { userModules } = useModuleAccess();

  const visible = tabs.filter(
    (t) => !t.module || userModules.length === 0 || userModules.includes(t.module),
  );
  const list = visible.length > 0 ? visible : tabs;
  const activeTab = list.find((t) => t.key === active) ?? tabs.find((t) => t.key === active) ?? list[0];

  return (
    <div>
      <BackofficePageHeader
        title={activeTab?.label ?? moduleLabel ?? ""}
        description={moduleLabel}
      />
      <SubmenuBar
        moduleLabel={moduleLabel}
        items={list.map((t) => ({ key: t.path, label: t.label }))}
        active={activeTab?.path ?? list[0]?.path}
        onSelect={(key) => navigate(key)}
      />
      {activeTab?.render() ?? null}
    </div>
  );
}
