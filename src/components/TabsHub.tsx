import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { SubmenuBar } from "@/components/SubmenuBar";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { useModuleAccess } from "@/hooks/usePermissions";
import { Loader2 } from "lucide-react";

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
  /** Destino do botão voltar (default: "/") */
  backTo?: string;
}

/**
 * Shared layout for hub pages (Auditoria, Integrações, Usuários).
 * Renderiza a própria régua de submódulos (não depende do submenu global,
 * que pode não encontrar o host em algumas telas).
 */
export function TabsHub<K extends string>({ tabs, active, moduleLabel, backTo = "/" }: TabsHubProps<K>) {
  const navigate = useNavigate();
  const { userModules, loading } = useModuleAccess();

  const visible = tabs.filter(
    (t) => !t.module || userModules.length === 0 || userModules.includes(t.module),
  );
  const activeTab = visible.find((t) => t.key === active) ?? null;

  useEffect(() => {
    if (loading || activeTab || visible.length === 0) return;
    navigate(visible[0].path, { replace: true });
  }, [activeTab, loading, navigate, visible]);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div>
        <BackofficePageHeader
          title="Acesso negado"
          description={moduleLabel}
          backTo={backTo}
        />
        <div className="px-6 py-10 text-sm text-muted-foreground">
          Você não possui permissão para acessar este módulo.
        </div>
      </div>
    );
  }

  if (!activeTab) return null;

  return (
    <div>
      <BackofficePageHeader
        title={activeTab?.label ?? moduleLabel ?? ""}
        description={moduleLabel}
        backTo={backTo}
      />
      <SubmenuBar
        moduleLabel={moduleLabel}
        items={visible.map((t) => ({ key: t.path, label: t.label }))}
        active={activeTab.path}
        onSelect={(key) => navigate(key)}
      />
      {activeTab.render()}
    </div>
  );
}
