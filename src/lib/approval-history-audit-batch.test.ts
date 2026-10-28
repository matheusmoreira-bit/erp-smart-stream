import { describe, expect, it, vi } from "vitest";
import { auditCutoff, dedupeAuditDecisions, pendingAuditUpdates, writeAuditBatches, SAP_HANA_TIMEOUT_MS, type AuditDecision } from "../../supabase/functions/approval-history-sync/audit-batch";

const now = Date.parse("2026-10-28T15:26:00Z");
const decision = (entity: string, actor: string, date: string, action = "approve"): AuditDecision => ({
  entity_id: entity, actor_email: actor, created_at: date, action, details: null, company_db: "SBO_ANAGAMING",
});

describe("audit sync batching and cutoff", () => {
  it("falls back to exactly 30 days without prior success", () => {
    expect(auditCutoff(now)).toBe("2026-09-28T15:26:00.000Z");
  });
  it("reads only since the successful company checkpoint", () => {
    expect(auditCutoff(now, "2026-10-27T10:00:00Z")).toBe("2026-10-27T10:00:00.000Z");
  });
  it("caps lookback at 180 days", () => {
    expect(auditCutoff(now, "2025-01-01T00:00:00Z")).toBe(new Date(now - 180 * 86400000).toISOString());
  });
  it("deduplicates each code and actor using the newest decision", () => {
    const latest = decision("2577", "actor@example.test", "2026-10-28T12:00:00Z", "reject");
    expect(dedupeAuditDecisions([decision("2577", "ACTOR@example.test", "2026-10-27T12:00:00Z"), latest])).toEqual([latest]);
  });
  it("updates original pending rows using the newest code decision without changing final or unrelated rows", () => {
    const rows = [
      { external_id: "2577::original", decision: "P", remarks: "preserved" },
      { external_id: "2577::final", decision: "Y" },
      { external_id: "25770::other", decision: "P" },
    ];
    expect(pendingAuditUpdates(rows, [decision("2577", "a@example.test", "2026-10-28T12:00:00Z", "reject")], "now"))
      .toEqual([{ ...rows[0], decision: "N", decision_date: "2026-10-28T12:00:00Z", synced_at: "now" }]);
  });
  it("writes 585 decisions as 200, 200, 185 rather than per decision", async () => {
    const write = vi.fn(async (_batch: number[]) => {});
    expect(await writeAuditBatches(Array.from({ length: 585 }, (_, i) => i), write)).toBe(585);
    expect(write.mock.calls.map(([batch]) => batch.length)).toEqual([200, 200, 185]);
  });
  it("stops a failed batch rather than treating it as successful", async () => {
    const write = vi.fn(async (_batch: number[]) => { throw new Error("failed"); });
    await expect(writeAuditBatches([1, 2], write)).rejects.toThrow("failed");
  });
  it("limits SAP and HANA calls to 15 seconds", () => {
    expect(SAP_HANA_TIMEOUT_MS).toBe(15_000);
  });
});