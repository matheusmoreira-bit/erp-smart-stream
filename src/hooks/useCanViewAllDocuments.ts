import { useMyPermissionGroups } from "@/hooks/useMyPermissionGroups";
import { isBasicGroup } from "@/lib/permission-group-utils";

/**
 * Quem pode ver a opção "Ver todos" (documentos, aprovações, anexos):
 * apenas usuários do grupo "Usuário" ficam restritos aos próprios documentos.
 * Admins/super-usuários e qualquer outro grupo (Facilities, Fiscal, Financeiro,
 * Contas a Pagar/Receber, CFO, Contábil, PagCorp...) podem ver tudo.
 */
export function useCanViewAllDocuments(): { canViewAll: boolean; loading: boolean } {
  const { groups, isPrivileged, loading } = useMyPermissionGroups();
  const canViewAll = isPrivileged || groups.some((g) => !isBasicGroup(g));
  return { canViewAll, loading };
}
