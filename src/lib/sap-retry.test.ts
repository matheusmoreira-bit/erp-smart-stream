import { describe, expect, it } from "vitest";
import { shouldExhaustRetry } from "../../supabase/functions/_shared/sap-retry";

describe("SAP retry resiliente", () => {
  it.each(["network", "timeout", "session"] as const)(
    "não esgota falhas de infraestrutura (%s)",
    (category) => {
      expect(shouldExhaustRetry({ retryable: true, category, reason: "down" }, 100, 5)).toBe(false);
    },
  );

  it("mantém o limite para falhas funcionais retentáveis", () => {
    expect(shouldExhaustRetry({ retryable: true, category: "lock", reason: "busy" }, 5, 5)).toBe(true);
  });

  it("encerra imediatamente erros não retentáveis", () => {
    expect(shouldExhaustRetry({ retryable: false, category: "business", reason: "invalid" }, 1, 5)).toBe(true);
  });
});
