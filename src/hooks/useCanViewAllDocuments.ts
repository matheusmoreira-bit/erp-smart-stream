import { useMyCapabilities } from "@/hooks/useMyCapabilities";

/**
 * Quem pode ver a opção "Ver todos" (documentos, aprovações, anexos).
 *
 * Decidido exclusivamente pelas capacidades do GRUPO
 * (`expenses_view_all` / `approvals_view_all`) — sem regra por nome de grupo.
 */
export function useCanViewAllDocuments(): { canViewAll: boolean; loading: boolean } {
  const { has, loading } = useMyCapabilities();
  return { canViewAll: has("expenses_view_all") || has("approvals_view_all"), loading };
}
