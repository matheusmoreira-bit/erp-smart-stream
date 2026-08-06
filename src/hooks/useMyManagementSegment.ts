import { useMemo } from "react";
import { useSap } from "@/contexts/SapContext";
import { useManagementSegments, type ManagementSegment } from "@/hooks/useManagementSegments";

/** Segmento de gestão (ANA Gaming / Lótus / CSC) do usuário logado. Padrão: ANA Gaming. */
export function useMyManagementSegment(): { segment: ManagementSegment; loading: boolean } {
  const { session } = useSap();
  const { segmentOf, loading } = useManagementSegments();
  const segment = useMemo(
    () => segmentOf(session?.userName, (session as { email?: string } | null)?.email),
    [segmentOf, session],
  );
  return { segment, loading };
}
