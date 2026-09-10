import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import { useMyCapabilities } from "@/hooks/useMyCapabilities";
import { useCurrentUserCostCenter, costCenterBranch } from "@/hooks/useCurrentUserCostCenter";
import { identityMatches } from "@/lib/permission-group-utils";

export interface DirectorateScope {
  /** Diretoria visível (CC de 2º nível, ex.: "1.6") ou null. */
  branch: string | null;
  /** True quando o grupo tem a capacidade "ver documentos da própria diretoria". */
  isDirectorateUser: boolean;
  /** True quando o grupo tem a capacidade "ver lançamentos do time da diretoria". */
  isTeamDirectorateUser: boolean;
  loading: boolean;
  /** Um centro de custo pertence à diretoria do usuário? */
  matches: (costCenter: string | null | undefined) => boolean;
  /** O autor/solicitante do documento pertence à mesma diretoria do usuário? */
  matchesRequester: (identifier: string | null | undefined) => boolean;
}

/** Identificadores (e-mails e user_code) dos colegas da mesma diretoria. */
function usePeerIdentifiers(enabled: boolean): Set<string> {
  const { session } = useSap();
  const sapUserName = session?.userName || "";
  const [peers, setPeers] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setPeers(new Set());
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_my_directorate_peers", {
          _sap_user_name: sapUserName || null,
        } as any);
        if (cancelled || error || !Array.isArray(data)) return;
        const set = new Set<string>();
        for (const row of data as any[]) {
          for (const v of [row?.sap_email, row?.idp_email, row?.sap_user_code]) {
            const s = String(v || "").trim().toLowerCase();
            if (s) set.add(s);
          }
        }
        setPeers(set);
      } catch {
        /* falha de rede não amplia nem reduz privilégio além do próprio usuário */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, sapUserName]);

  return peers;
}

/**
 * Escopo por diretoria — duas capacidades independentes e combináveis:
 *
 * - `documents_view_directorate`: recorte pelo CENTRO DE CUSTO do documento
 *   (CC de 2º nível vindo do IdP: 1.6.1.2 → 1.6.%).
 * - `documents_view_team_directorate`: recorte pelo AUTOR do documento — vê
 *   tudo que colegas da mesma diretoria lançaram, em qualquer CC.
 *
 * Sem CC no IdP, o usuário continua vendo apenas os próprios documentos.
 */
export function useDirectorateScope(): DirectorateScope {
  const { isPrivileged, capabilities, loading: loadingGroups } = useMyCapabilities();
  const { costCenter, loading: loadingCc } = useCurrentUserCostCenter();

  // Visão total prevalece sobre os recortes por diretoria.
  const hasFullView =
    isPrivileged ||
    capabilities.has("expenses_view_all") ||
    capabilities.has("approvals_view_all");

  const isDirectorateUser = !hasFullView && capabilities.has("documents_view_directorate");
  const isTeamDirectorateUser =
    !hasFullView && capabilities.has("documents_view_team_directorate");

  const branch =
    isDirectorateUser || isTeamDirectorateUser ? costCenterBranch(costCenter) : null;

  const peers = usePeerIdentifiers(isTeamDirectorateUser && !!branch);

  const matches = (cc: string | null | undefined) => {
    if (!isDirectorateUser || !branch) return false;
    const v = String(cc || "").trim();
    if (!v) return false;
    return v === branch || v.startsWith(`${branch}.`);
  };

  const matchesRequester = (identifier: string | null | undefined) => {
    if (!isTeamDirectorateUser || !peers.size) return false;
    const raw = String(identifier || "").trim().toLowerCase();
    if (!raw) return false;
    if (peers.has(raw)) return true;
    const local = raw.split("@")[0];
    if (local && peers.has(local)) return true;
    for (const p of peers) {
      if (identityMatches(p, raw)) return true;
    }
    return false;
  };

  return {
    branch,
    isDirectorateUser,
    isTeamDirectorateUser,
    loading: loadingGroups || loadingCc,
    matches,
    matchesRequester,
  };
}
