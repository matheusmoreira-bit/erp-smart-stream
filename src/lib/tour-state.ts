/**
 * Estado dos tours (concluído/pulado) persistido no perfil do usuário.
 *
 * Fonte de verdade: tabela `public.user_tour_state`, escopada por `auth.uid()`,
 * de modo que o tour não reapareça em outro navegador ou dispositivo.
 * O localStorage é mantido apenas como cache local (pintura imediata e
 * fallback quando o usuário ainda não tem sessão do Cloud).
 */
import { supabase } from "@/integrations/supabase/client";

type TourKey = string;

let cache: Set<TourKey> | null = null;
let inflight: Promise<Set<TourKey>> | null = null;

function localKey(key: TourKey) {
  return `erp-tour:${key}`;
}

export function isSeenLocally(key: TourKey): boolean {
  try {
    return !!localStorage.getItem(localKey(key));
  } catch {
    return false;
  }
}

function markLocally(key: TourKey) {
  try {
    localStorage.setItem(localKey(key), new Date().toISOString());
  } catch {
    /* ignore */
  }
}

function clearLocally(key: TourKey) {
  try {
    localStorage.removeItem(localKey(key));
  } catch {
    /* ignore */
  }
}

/** Carrega (com cache em memória) os tours já concluídos pelo usuário logado. */
export async function loadSeenTours(): Promise<Set<TourKey>> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const seen = new Set<TourKey>();
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return seen;
      const { data } = await supabase
        .from("user_tour_state")
        .select("tour_key")
        .eq("user_id", uid);
      for (const row of data || []) {
        seen.add(row.tour_key);
        markLocally(row.tour_key);
      }
    } catch {
      /* offline / sem sessão: cai no cache local */
    }
    cache = seen;
    return seen;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** true quando o tour já foi concluído ou pulado por este usuário. */
export async function hasSeenTour(key: TourKey): Promise<boolean> {
  if (isSeenLocally(key)) return true;
  const seen = await loadSeenTours();
  return seen.has(key);
}

/** Marca o tour como concluído/pulado no perfil do usuário (e no cache local). */
export async function markTourSeen(key: TourKey): Promise<void> {
  markLocally(key);
  cache?.add(key);
  try {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return;
    await supabase
      .from("user_tour_state")
      .upsert(
        { user_id: uid, tour_key: key, completed_at: new Date().toISOString() },
        { onConflict: "user_id,tour_key" },
      );
  } catch {
    /* mantém apenas o cache local se a gravação falhar */
  }
}

/** Reabre o tour para este usuário em todos os dispositivos. */
export async function resetTour(key: TourKey): Promise<void> {
  clearLocally(key);
  cache?.delete(key);
  try {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return;
    await supabase.from("user_tour_state").delete().eq("user_id", uid).eq("tour_key", key);
  } catch {
    /* ignore */
  }
}
