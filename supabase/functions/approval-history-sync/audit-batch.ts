export const AUDIT_BATCH_SIZE = 200;
export const SAP_HANA_TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function withRemoteTimeout<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timeout após 15 s`)), SAP_HANA_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function auditCutoff(now: number, lastSuccess?: string | null): string {
  const parsed = lastSuccess ? Date.parse(lastSuccess) : NaN;
  const since = Number.isFinite(parsed) && parsed <= now ? parsed : now - 30 * DAY_MS;
  return new Date(Math.max(since, now - 180 * DAY_MS)).toISOString();
}

export interface AuditDecision {
  action: string;
  entity_id: string | null;
  actor_email: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
  company_db: string | null;
}

export function dedupeAuditDecisions(rows: AuditDecision[]): AuditDecision[] {
  const seen = new Set<string>();
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).filter((row) => {
    if (!row.entity_id || !row.actor_email) return false;
    const key = `${row.entity_id}::${row.actor_email.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The newest decision for a code resolves every original pending approver,
// exactly as the old descending per-decision UPDATE loop did.
export function pendingAuditUpdates<T extends { external_id: string; decision: string | null }>(
  pending: T[], decisions: AuditDecision[], syncedAt: string,
): Array<T & { decision: string; decision_date: string; synced_at: string }> {
  const byCode = new Map<string, AuditDecision>();
  for (const row of dedupeAuditDecisions(decisions)) {
    if (row.entity_id && !byCode.has(row.entity_id)) byCode.set(row.entity_id, row);
  }
  return pending.flatMap((row) => {
    if (row.decision !== "P") return [];
    const separator = row.external_id.indexOf("::");
    if (separator < 0) return [];
    const decision = byCode.get(row.external_id.slice(0, separator));
    return decision ? [{ ...row, decision: decision.action === "approve" ? "Y" : "N", decision_date: decision.created_at, synced_at: syncedAt }] : [];
  });
}

export async function writeAuditBatches<T>(rows: T[], write: (batch: T[]) => Promise<void>): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += AUDIT_BATCH_SIZE) {
    const batch = rows.slice(i, i + AUDIT_BATCH_SIZE);
    await write(batch);
    written += batch.length;
  }
  return written;
}