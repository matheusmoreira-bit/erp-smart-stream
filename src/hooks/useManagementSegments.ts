import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { canonicalUserKey } from "@/lib/user-identity";

export type ManagementSegment = "gestao_1" | "gestao_2";

export const MANAGEMENT_SEGMENT_LABEL: Record<ManagementSegment, string> = {
  gestao_1: "Gestão 1",
  gestao_2: "Gestão 2",
};

/**
 * Campo opcional de segmentação da empresa (Gestão 1 / Gestão 2),
 * guardado por usuário canônico em `sap_user_directory.management_segment`.
 * Padrão: Gestão 1.
 */
export function useManagementSegments() {
  const [map, setMap] = useState<Record<string, ManagementSegment>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sap_user_directory")
      .select("user_key, management_segment");
    const next: Record<string, ManagementSegment> = {};
    for (const row of (data || []) as { user_key: string; management_segment: string | null }[]) {
      next[row.user_key] = row.management_segment === "gestao_2" ? "gestao_2" : "gestao_1";
    }
    setMap(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const segmentOf = useCallback(
    (...identities: (string | null | undefined)[]): ManagementSegment => {
      for (const id of identities) {
        const key = canonicalUserKey(id);
        if (key && map[key]) return map[key];
      }
      return "gestao_1";
    },
    [map],
  );

  const setSegment = useCallback(
    async (identity: string | null | undefined, segment: ManagementSegment) => {
      const key = canonicalUserKey(identity);
      if (!key) throw new Error("Usuário inválido");
      const { error } = await supabase
        .from("sap_user_directory")
        .upsert([{ user_key: key, management_segment: segment }], { onConflict: "user_key" });
      if (error) throw new Error(error.message);
      setMap((prev) => ({ ...prev, [key]: segment }));
    },
    [],
  );

  return { loading, segmentOf, setSegment, refresh };
}
