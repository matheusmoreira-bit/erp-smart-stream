import { useMemo } from "react";
import { useSap } from "@/contexts/SapContext";
import { useManagementSegments, type ManagementSegment } from "@/hooks/useManagementSegments";

/** Segmento de gestão (Gestão 1/2) do usuário logado. Padrão: Gestão 1. */
export function useMyManagementSegment(): { segment: ManagementSegment; loading: boolean } {
  const { session } = useSap();
  const { segmentOf, loading } = useManagementSegments();
  const segment = useMemo(
    () => segmentOf(session?.userName, (session as { email?: string } | null)?.email),
    [segmentOf, session],
  );
  return { segment, loading };
}
