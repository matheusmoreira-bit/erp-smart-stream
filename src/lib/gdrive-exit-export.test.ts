import { describe, expect, it } from "vitest";
import { CATALOG, EXCLUDED } from "../../supabase/functions/export-to-gdrive/catalog";
import { canComplete, csvCell, sanitize, SHARED_DRIVE, PENDING_BUCKETS } from "../../supabase/functions/export-to-gdrive/core";
describe("exit export security and completion", () => {
  it("never exports credentials or authentication/session tables", () => {
    const allowed = CATALOG.map(t => String(t.table));
    for (const t of ["system_credentials", "user_sap_credentials", "api_keys", "approval_action_tokens", "erp_session_cache", "impersonation_sessions"]) {
      expect(allowed.includes(t)).toBe(false);
      expect(EXCLUDED.some(e => e.table === t)).toBe(true);
    }
    expect(allowed.includes("expenses")).toBe(true);
    expect(allowed.includes("user_profiles")).toBe(true);
  });
  it("removes credentials in nested objects and arrays without losing business amounts", () => {
    const result = sanitize({ amount: 42, metadata: { password: "synthetic-only", nested: [{ token: "synthetic-only", vendor: "Supplier" }] } });
    expect(result).toEqual({ amount: 42, metadata: { nested: [{ vendor: "Supplier" }] } });
  });
  it("neutralizes spreadsheet formulas and escapes CSV separators", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe('"\'=SUM(A1:A2)"');
    expect(csvCell('a;"b')).toBe('"a;""b"');
    expect(csvCell(-42)).toBe('"-42"');
  });
  it("does not mark complete while attachments or SAP remain pending", () => {
    expect(canComplete(true, true, 6, 0)).toBe(false);
    expect(canComplete(true, false, 0, 0)).toBe(false);
    expect(canComplete(true, true, 0, 1)).toBe(false);
    expect(canComplete(true, true, 0, 0)).toBe(true);
  });
  it("uses only the authorized shared destination and all six requested buckets", () => {
    expect(SHARED_DRIVE).toBe("0AEGlkXe3D_4wUk9PVA");
    expect(PENDING_BUCKETS).toEqual(["expense-attachments", "sap-archive", "registration-attachments", "nf-entrada-files", "nfse-pdfs", "nfse-xmls"]);
  });
});