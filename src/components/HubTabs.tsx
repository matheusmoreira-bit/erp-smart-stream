import { SubmenuBar } from "@/components/SubmenuBar";

export interface HubTab {
  key: string;
  label: string;
}

interface HubTabsProps {
  tabs: HubTab[];
  active: string;
  onChange: (key: string) => void;
  moduleLabel?: string;
}

/**
 * Submenu das páginas de hub (Aprovações, Auditoria, Integrações, Usuários).
 * Renderizado como dropdown compacto no topo da página.
 */
export function HubTabs({ tabs, active, onChange, moduleLabel }: HubTabsProps) {
  return (
    <SubmenuBar
      moduleLabel={moduleLabel}
      items={tabs}
      active={active}
      onSelect={onChange}
    />
  );
}
