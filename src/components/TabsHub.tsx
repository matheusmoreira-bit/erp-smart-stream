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
  /** Mantido por compatibilidade — o submenu agora é global (ModuleSubmenu). */
  moduleLabel?: string;
}

/**
 * Shared layout for hub pages (Auditoria, Integrações, Usuários).
 * A navegação entre submódulos vive na barra global de submenu.
 */
export function TabsHub<K extends string>({ tabs, active }: TabsHubProps<K>) {
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];
  return <div>{activeTab?.render() ?? null}</div>;
}
