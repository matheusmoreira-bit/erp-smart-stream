// Shared helpers for the SAP retry queue.
// Classifies integration failures (mostly 400s coming back from SAP) into
// retryable / non-retryable and enqueues a row in `public.sap_retry_queue`
// so `sap-retry-worker` can reprocess them with exponential backoff.

export type SapRetryDocType =
  | "expense"
  | "advance"
  | "baixa"
  | "pagcorp"
  | "synapse_pagcorp";

export type SapErrorCategory =
  | "session"
  | "branch"
  | "date"
  | "attachment"
  | "project"
  | "lock"
  | "timeout"
  | "network"
  | "business"
  | "other";

export interface ClassifiedSapError {
  retryable: boolean;
  category: SapErrorCategory;
  reason: string;
}

// Errors we NEVER want to retry automatically — they need human action.
const NON_RETRYABLE_PATTERNS: RegExp[] = [
  /not authorized/i,
  /insufficient/i,
  /permission/i,
  /budget/i,
  /duplicate/i,
  /already exists/i,
  /foreign key/i,
  /business partner .*(hold|inactive|frozen)/i,
  /invalid.*(bp|business partner|vendor|customer)/i,
  /account.*locked/i,
  /-2035/, // SAP: general validation (bad G/L account)
  /-5017/, // SAP: BP is blocked
  /Base Document.*closed/i,
];

// Categorized retryable patterns (evaluated in order).
const RETRYABLE_PATTERNS: Array<{ re: RegExp; cat: SapErrorCategory }> = [
  { re: /SessionId invalido|session.*(expir|invalid)|-1200|401|Unauthorized/i, cat: "session" },
  { re: /BPLID|not assigned to selected branch|\bbranch\b/i, cat: "branch" },
  { re: /Specify a date within the permissible range|permissible range|posting period/i, cat: "date" },
  { re: /Attachments2 failed|File name.*space string|file name/i, cat: "attachment" },
  { re: /-1116|LINHAS MARCA\/BRAND|marca.*projeto/i, cat: "project" },
  { re: /\bin use\b|locked|blocked by another user|record is being used/i, cat: "lock" },
  { re: /timeout|timed out|ETIMEDOUT|ECONNRESET|network|fetch failed/i, cat: "network" },
  { re: /\b5\d\d\b|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout/i, cat: "timeout" },
];

export function classifySapError(status: number | undefined, body: unknown): ClassifiedSapError {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  // Blocklist first — business errors even inside a 400 must not be retried.
  for (const p of NON_RETRYABLE_PATTERNS) {
    if (p.test(text)) {
      return { retryable: false, category: "business", reason: text.slice(0, 300) };
    }
  }
  // 5xx: always retryable (network).
  if (status && status >= 500) {
    return { retryable: true, category: "network", reason: `HTTP ${status}` };
  }
  // Match retryable categories.
  for (const p of RETRYABLE_PATTERNS) {
    if (p.re.test(text)) {
      return { retryable: true, category: p.cat, reason: text.slice(0, 300) };
    }
  }
  // Default: only retry on 400 with unknown reason if it does NOT look like validation.
  // Conservative: mark as non-retryable so we don't loop on business rules.
  return { retryable: false, category: "other", reason: text.slice(0, 300) };
}

// Backoff schedule: 2m → 4m → 8m → 16m → 32m (attempts is the NEW count after failure).
export function backoffMinutes(attempts: number): number {
  const schedule = [2, 4, 8, 16, 32];
  const idx = Math.min(Math.max(attempts - 1, 0), schedule.length - 1);
  return schedule[idx];
}

export interface EnqueueRetryParams {
  doc_type: SapRetryDocType;
  ref_id: string;
  company_db?: string | null;
  payload?: Record<string, unknown>;
  error: string;
  category?: SapErrorCategory;
  max_attempts?: number;
}

// Upserts a retry row keyed by (doc_type, ref_id) if there is no active one.
// If an active row exists, we bump `last_error` but keep the existing schedule
// (worker owns the counter). Returns { enqueued, id }.
// deno-lint-ignore no-explicit-any
export async function enqueueRetry(admin: any, params: EnqueueRetryParams): Promise<{ enqueued: boolean; id?: string }> {
  try {
    // Look for an existing row for this document (any state except succeeded).
    // Reusing it keeps ONE row per documento — antes cada nova falha após
    // "exhausted" criava uma linha nova e poluía o histórico com dezenas de
    // duplicatas do mesmo pedido.
    const { data: existingRows } = await admin
      .from("sap_retry_queue")
      .select("id,attempts,status")
      .eq("doc_type", params.doc_type)
      .eq("ref_id", params.ref_id)
      .neq("status", "succeeded")
      .order("updated_at", { ascending: false })
      .limit(1);
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;

    if (existing?.id) {
      const isActive = existing.status === "pending" || existing.status === "in_flight";
      const patch: Record<string, unknown> = {
        last_error: params.error.slice(0, 2000),
        error_category: params.category ?? "other",
      };
      if (!isActive) {
        // Reabre a linha existente (exhausted/cancelled) em vez de inserir outra.
        patch.status = "pending";
        patch.attempts = 0;
        patch.notified_exhausted_at = null;
        patch.max_attempts = params.max_attempts ?? 5;
        patch.company_db = params.company_db ?? null;
        patch.payload = params.payload ?? {};
        patch.next_attempt_at = new Date(Date.now() + backoffMinutes(1) * 60_000).toISOString();
      }
      await admin.from("sap_retry_queue").update(patch).eq("id", existing.id);
      return { enqueued: !isActive, id: existing.id };
    }


    const nextAt = new Date(Date.now() + backoffMinutes(1) * 60_000).toISOString();
    const { data: inserted, error: iErr } = await admin
      .from("sap_retry_queue")
      .insert({
        doc_type: params.doc_type,
        ref_id: params.ref_id,
        company_db: params.company_db ?? null,
        payload: params.payload ?? {},
        max_attempts: params.max_attempts ?? 5,
        next_attempt_at: nextAt,
        last_error: params.error.slice(0, 2000),
        error_category: params.category ?? "other",
        status: "pending",
      })
      .select("id")
      .single();

    if (iErr) {
      console.warn("[sap-retry] enqueue failed:", iErr.message);
      return { enqueued: false };
    }
    return { enqueued: true, id: inserted?.id };
  } catch (e) {
    console.warn("[sap-retry] enqueue exception:", (e as Error).message);
    return { enqueued: false };
  }
}

// Convenience helper for callers that already know the raw error string.
// deno-lint-ignore no-explicit-any
export async function classifyAndEnqueue(
  admin: any,
  doc: Omit<EnqueueRetryParams, "error" | "category"> & { status?: number; errorBody: unknown },
): Promise<{ enqueued: boolean; classification: ClassifiedSapError }> {
  const cls = classifySapError(doc.status, doc.errorBody);
  if (!cls.retryable) return { enqueued: false, classification: cls };
  const res = await enqueueRetry(admin, {
    doc_type: doc.doc_type,
    ref_id: doc.ref_id,
    company_db: doc.company_db,
    payload: doc.payload,
    max_attempts: doc.max_attempts,
    error: cls.reason,
    category: cls.category,
  });
  return { enqueued: res.enqueued, classification: cls };
}
