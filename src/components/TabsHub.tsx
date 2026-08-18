import { Navigate, useNavigate } from "react-router-dom";
import { Loader2, ShieldX } from "lucide-react";
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

  if (loading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const list = tabs.filter((t) => !t.module || userModules.includes(t.module));
  if (list.length === 0) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-2 p-6 text-center">
        <ShieldX className="h-8 w-8 text-destructive" />
        <p className="font-semibold">Acesso negado</p>
        <p className="text-sm text-muted-foreground">Nenhuma área deste módulo está liberada para seu perfil.</p>
      </div>
    );
  }

  const activeTab = list.find((t) => t.key === active);
  if (!activeTab) return <Navigate to={list[0].path} replace />;

  return (
    <div>
      <BackofficePageHeader
        title={activeTab?.label ?? moduleLabel ?? ""}
        description={moduleLabel}
        backTo={backTo}
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
