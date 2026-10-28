export async function readOptionalWebhook<T>(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<{ rows: T[]; warning?: string }> {
  let status: number | undefined;
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    status = response.status;
    if (!response.ok) throw new Error("HTTP");
    const parsed: unknown = await response.json();
    const groups: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    const rows: T[] = [];
    for (const group of groups) {
      if (!group || typeof group !== "object" || !("data" in group) || !Array.isArray(group.data)) {
        throw new Error("JSON inválido");
      }
      rows.push(...group.data as T[]);
    }
    return { rows };
  } catch {
    const warning = `webhook-n8n: indisponível (${status === undefined ? "falha de conexão" : `HTTP ${status}`})`;
    console.warn(`[approval-history-sync] ${warning}`);
    return { rows: [], warning };
  }
}

export function finalSyncStatus(auditError: string | undefined, hanaError: string | undefined): "success" | "error" {
  return auditError && hanaError ? "error" : "success";
}