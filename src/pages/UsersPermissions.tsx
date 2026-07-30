import { useAuth } from "@/hooks/useAuth";
import { Loader2, ShieldAlert } from "lucide-react";
import PermissionManager from "@/components/PermissionManager";
import { PageTitle } from "@/components/PageTitle";

/**
 * Permissões e grupos — agora dentro do módulo de Usuários.
 * (Antes vivia apenas na aba "Permissões" do backoffice.)
 */
export default function UsersPermissions() {
  const { isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-2">
        <ShieldAlert className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Acesso restrito</p>
        <p className="text-xs text-muted-foreground">
          Somente administradores do backoffice podem gerenciar grupos e permissões.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <PageTitle title="Permissões e Grupos" />
      <PermissionManager />
    </div>
  );
}
