import { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useModuleAccess } from "@/hooks/usePermissions";

export function ModuleRoute({ moduleKey, children }: { moduleKey: string; children: ReactNode }) {
  const { hasAccess, loading } = useModuleAccess(moduleKey);

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
