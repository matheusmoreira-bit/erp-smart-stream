// Lock global por watcher (impede execuções concorrentes da mesma rotina).
// Usa a tabela public.watcher_runs via RPCs SECURITY DEFINER.

export async function tryWatcherLock(
  supabase: any,
  watcherName: string,
  ttlMinutes = 10,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("try_watcher_lock", {
    _name: watcherName,
    _ttl_minutes: ttlMinutes,
  });
  if (error) {
    console.warn(`[tryWatcherLock] ${watcherName}: ${error.message}`);
    return false;
  }
  return data === true;
}

export async function releaseWatcherLock(
  supabase: any,
  watcherName: string,
  status: "ok" | "error" = "ok",
  message?: string,
): Promise<void> {
  try {
    await supabase.rpc("release_watcher_lock", {
      _name: watcherName,
      _status: status,
      _message: message ?? null,
    });
  } catch (e) {
    console.warn(`[releaseWatcherLock] ${watcherName}:`, e);
  }
}

/** Verifica se um company_db é base de teste (deve ser ignorada por watchers). */
export function isTestCompanyDb(db: string | null | undefined): boolean {
  if (!db) return false;
  return /^SBO_TESTE_/i.test(db);
}
