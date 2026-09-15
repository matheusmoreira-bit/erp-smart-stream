// Modo standalone (temporário) por empresa — lado do app.
//
// Quando ligado, o Flow opera apenas com os cadastros já copiados para o banco
// (`sap_cache`): nenhuma tela consulta o ERP e nenhuma integração é disparada.
import { supabase } from "@/integrations/supabase/client";

export interface StandaloneMode {
  company_db: string;
  enabled: boolean;
  reason: string | null;
  ends_at: string | null;
  snapshot_at: string | null;
}

const TTL_MS = 30_000;
let cache: { at: number; rows: Map<string, StandaloneMode> } | null = null;
let inflight: Promise<Map<string, StandaloneMode>> | null = null;
const listeners = new Set<() => void>();

function isActive(row: StandaloneMode): boolean {
  if (!row.enabled) return false;
  if (!row.ends_at) return true;
  const ends = new Date(row.ends_at).getTime();
  return !isFinite(ends) || ends > Date.now();
}

async function fetchRows(): Promise<Map<string, StandaloneMode>> {
  const map = new Map<string, StandaloneMode>();
  try {
    const { data } = await supabase
      .from("standalone_mode")
      .select("company_db, enabled, reason, ends_at, snapshot_at");
    for (const row of (data || []) as StandaloneMode[]) map.set(row.company_db, row);
  } catch {
    /* mantém o que já estava em memória */
  }
  cache = { at: Date.now(), rows: map };
  return map;
}

export async function loadStandaloneModes(force = false): Promise<Map<string, StandaloneMode>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (!inflight) {
    inflight = fetchRows().finally(() => {
      inflight = null;
      for (const cb of listeners) cb();
    });
  }
  return inflight;
}

/** Leitura síncrona (usa o que já foi carregado). */
export function isCompanyStandaloneSync(companyDb?: string | null): boolean {
  if (!companyDb || !cache) return false;
  const row = cache.rows.get(companyDb);
  return !!row && isActive(row);
}

export async function getStandaloneMode(companyDb?: string | null): Promise<StandaloneMode | null> {
  if (!companyDb) return null;
  const rows = await loadStandaloneModes();
  const row = rows.get(companyDb);
  return row && isActive(row) ? row : null;
}

export function subscribeStandaloneModes(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function invalidateStandaloneModes() {
  cache = null;
  void loadStandaloneModes(true);
}
