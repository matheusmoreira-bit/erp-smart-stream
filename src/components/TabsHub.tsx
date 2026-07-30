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
 * Filters tabs by module access, renders the submenu dropdown and the active body.
 */
export function TabsHub<K extends string>({ tabs, active, moduleLabel }: TabsHubProps<K>) {
  const { userModules } = useModuleAccess();

  const visible = tabs.filter(
    (t) => userModules.length === 0 || userModules.includes(t.module),
  );

  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];
  const Body = activeTab?.render() ?? null;

  return (
    <div>
      {Body}
    </div>
  );
}
