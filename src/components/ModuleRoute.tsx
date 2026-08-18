import type { ReactNode } from "react";
import { Loader2, ShieldX } from "lucide-react";
import { useModuleAccess } from "@/hooks/usePermissions";

export function ModuleRoute({ module, children }: { module: string; children: ReactNode }) {
  const { hasAccess, loading } = useModuleAccess(module);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <ShieldX className="h-8 w-8 mx-auto text-destructive" />
          <p className="font-semibold">Acesso negado</p>
          <p className="text-sm text-muted-foreground">Seu perfil não possui acesso a este módulo.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
