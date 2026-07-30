import { useAuth } from "@/hooks/useAuth";
import { useMyPermissionGroups } from "@/hooks/useMyPermissionGroups";
import { Loader2, ShieldAlert } from "lucide-react";
import AdminUsersManager from "@/components/AdminUsersManager";
import { IdpBindingFlagCard } from "@/components/IdpBindingFlagCard";
import { PageTitle } from "@/components/PageTitle";

/**
 * Administradores do backoffice + política de vínculo de identidade (IdP),
 * unificados dentro do módulo de Usuários.
 */
export default function UsersAdmins() {
  const { isAdmin, loading } = useAuth();
  const { isPrivileged, loading: permissionLoading } = useMyPermissionGroups();

  if (loading || permissionLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin && !isPrivileged) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-2">
        <ShieldAlert className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Acesso restrito</p>
        <p className="text-xs text-muted-foreground">
          Somente administradores do backoffice podem gerenciar esta área.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8">
      <PageTitle title="Administradores" />
      <IdpBindingFlagCard />
      <AdminUsersManager />
    </div>
  );
}
