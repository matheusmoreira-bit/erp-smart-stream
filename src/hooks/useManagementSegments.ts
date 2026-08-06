import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { canonicalUserKey } from "@/lib/user-identity";

export type ManagementSegment = "gestao_1" | "gestao_2" | "csc";

export const MANAGEMENT_SEGMENT_LABEL: Record<ManagementSegment, string> = {
  gestao_1: "ANA Gaming",
  gestao_2: "Lótus",
  csc: "CSC",
};

export const MANAGEMENT_SEGMENTS: ManagementSegment[] = ["gestao_1", "gestao_2", "csc"];

function parseSegment(value: string | null | undefined): ManagementSegment {
  return value === "gestao_2" || value === "csc" ? value : "gestao_1";
}

/**
 * Campo opcional de segmentação da empresa (ANA Gaming / Lótus / CSC),
 * guardado por usuário canônico em `sap_user_directory.management_segment`.
 * Padrão: ANA Gaming.
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
      next[row.user_key] = parseSegment(row.management_segment);
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
