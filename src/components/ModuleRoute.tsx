import { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useModuleAccess } from "@/hooks/usePermissions";
import { useSap } from "@/contexts/SapContext";
import { isPathDeniedForErp } from "@/lib/erp-module-availability";

export function ModuleRoute({ moduleKey, children }: { moduleKey: string; children: ReactNode }) {
  const { hasAccess, loading } = useModuleAccess(moduleKey);
  const { pathname } = useLocation();
  const { session } = useSap();

  // Telas que não existem no ERP da empresa atual (ex.: contabilidade no Omie).
  if (isPathDeniedForErp(pathname, session?.erpType)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-foreground">Tela indisponível</p>
          <p className="text-sm text-muted-foreground">
            Esta tela não está disponível para empresas que utilizam o Omie.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-foreground">Acesso negado</p>
          <p className="text-sm text-muted-foreground">
            Sua conta não possui permissão para acessar este módulo.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
