import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { canonicalUserKey } from "@/lib/user-identity";

export type ManagementSegment = "gestao_1" | "gestao_2" | "csc" | "betbet" | "donald";

export const MANAGEMENT_SEGMENT_LABEL: Record<ManagementSegment, string> = {
  gestao_1: "ANA Gaming",
  gestao_2: "Lótus",
  csc: "CSC",
  betbet: "BET.BET",
  donald: "DONALD",
};

export const MANAGEMENT_SEGMENTS: ManagementSegment[] = [
  "gestao_1",
  "gestao_2",
  "csc",
  "betbet",
  "donald",
];

const OPEN_GAMING_DBS = ["open_gaming_sa", "SBO_OPENGAMING", "SBO_TST_OPENGAMING"];
/** Bases em que só existe a gestão CSC (enxerga todos os projetos). */
const CSC_ONLY_DBS = ["SBO_CACTUS", "SBO_INSTITUTO_ANA", "cactus_providers"];

/** Segmentos oferecidos em cada base. A gestão pode variar por empresa. */
export function segmentsForCompany(companyDb: string | null | undefined): ManagementSegment[] {
  if (companyDb && OPEN_GAMING_DBS.includes(companyDb)) return ["csc", "betbet", "donald"];
  if (companyDb && CSC_ONLY_DBS.includes(companyDb)) return ["csc"];
  return ["gestao_1", "gestao_2", "csc"];
}

/** Gestão padrão de cada base quando o usuário ainda não tem definição própria. */
export function defaultSegmentForCompany(companyDb: string | null | undefined): ManagementSegment {
  const options = segmentsForCompany(companyDb);
  return options.includes("gestao_1") ? "gestao_1" : options[0];
}

const VALID_SEGMENTS = new Set<string>(MANAGEMENT_SEGMENTS);

function parseSegment(value: string | null | undefined): ManagementSegment | null {
  return value && VALID_SEGMENTS.has(value) ? (value as ManagementSegment) : null;
}

/**
 * Segmentação de gestão por usuário. O valor pode ser diferente em cada
 * empresa (`user_management_segments`); na ausência de definição por empresa
 * usa-se o valor global de `sap_user_directory.management_segment`.
 */
export function useManagementSegments(companyDb?: string | null) {
  const [globalMap, setGlobalMap] = useState<Record<string, ManagementSegment>>({});
  const [companyMap, setCompanyMap] = useState<Record<string, ManagementSegment>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [dir, perCompany] = await Promise.all([
      supabase.from("sap_user_directory").select("user_key, management_segment"),
      companyDb
        ? supabase
            .from("user_management_segments")
            .select("user_key, segment")
            .eq("company_db", companyDb)
        : Promise.resolve({ data: [] as { user_key: string; segment: string }[] }),
    ]);

    const nextGlobal: Record<string, ManagementSegment> = {};
    for (const row of (dir.data || []) as { user_key: string; management_segment: string | null }[]) {
      const parsed = parseSegment(row.management_segment);
      if (parsed) nextGlobal[row.user_key] = parsed;
    }
    const nextCompany: Record<string, ManagementSegment> = {};
    for (const row of ((perCompany as { data?: { user_key: string; segment: string }[] }).data ||
      [])) {
      const parsed = parseSegment(row.segment);
      if (parsed) nextCompany[row.user_key] = parsed;
    }
    setGlobalMap(nextGlobal);
    setCompanyMap(nextCompany);
    setLoading(false);
  }, [companyDb]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const segmentOf = useCallback(
    (...identities: (string | null | undefined)[]): ManagementSegment => {
      const allowed = segmentsForCompany(companyDb);
      const fallback = defaultSegmentForCompany(companyDb);
      for (const id of identities) {
        const key = canonicalUserKey(id);
        if (!key) continue;
        const value = companyMap[key] ?? globalMap[key];
        if (value) return allowed.includes(value) ? value : fallback;
      }
      return fallback;
    },
    [companyMap, globalMap, companyDb],
  );

  const setSegment = useCallback(
    async (identity: string | null | undefined, segment: ManagementSegment) => {
      const key = canonicalUserKey(identity);
      if (!key) throw new Error("Usuário inválido");
      if (companyDb) {
        const { error } = await supabase
          .from("user_management_segments")
          .upsert([{ user_key: key, company_db: companyDb, segment }], {
            onConflict: "user_key,company_db",
          });
        if (error) throw new Error(error.message);
        setCompanyMap((prev) => ({ ...prev, [key]: segment }));
        return;
      }
      const { error } = await supabase
        .from("sap_user_directory")
        .upsert([{ user_key: key, management_segment: segment }], { onConflict: "user_key" });
      if (error) throw new Error(error.message);
      setGlobalMap((prev) => ({ ...prev, [key]: segment }));
    },
    [companyDb],
  );

  return { loading, segmentOf, setSegment, refresh };
}
