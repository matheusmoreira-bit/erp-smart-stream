import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { AbortSignal as NodeAbortSignal } from "node:util";
import { readOptionalWebhook, finalSyncStatus } from "../../supabase/functions/approval-history-sync/webhook";

describe("optional approval history webhook", () => {
  beforeAll(() => {
    vi.stubGlobal("AbortSignal", { timeout: () => undefined });
  });
  afterAll(() => vi.unstubAllGlobals());
  it("returns empty rows and HTTP warning on 404", async () => {
    const result = await readOptionalWebhook("https://example.test", vi.fn<typeof fetch>().mockResolvedValue(new Response("missing", { status: 404 })));
    expect(result).toEqual({ rows: [], warning: "webhook-n8n: indisponível (HTTP 404)" });
  });
  it("continues after a network failure", async () => {
    const result = await readOptionalWebhook("https://example.test", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    expect(result.rows).toEqual([]);
    expect(result.warning).toContain("falha de conexão");
  });
  it("continues after invalid JSON", async () => {
    const result = await readOptionalWebhook("https://example.test", vi.fn<typeof fetch>().mockResolvedValue(new Response("not JSON")));
    expect(result.rows).toEqual([]);
    expect(result.warning).toContain("HTTP 200");
  });
  it("preserves valid webhook rows", async () => {
    const result = await readOptionalWebhook("https://example.test", vi.fn<typeof fetch>().mockResolvedValue(new Response('[{"data":[{"Code":123}]}]')));
    expect(result).toEqual({ rows: [{ Code: 123 }] });
  });
  it("only records error when audit and HANA both fail", () => {
    expect(finalSyncStatus(undefined, undefined)).toBe("success");
    expect(finalSyncStatus("audit failed", undefined)).toBe("success");
    expect(finalSyncStatus(undefined, "HANA failed")).toBe("success");
    expect(finalSyncStatus("audit failed", "HANA failed")).toBe("error");
  });
});