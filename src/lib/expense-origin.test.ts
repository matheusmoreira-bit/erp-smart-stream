import { describe, expect, it } from "vitest";
import { isNativeErpExpenseOrigin } from "../../supabase/functions/_shared/expense-origin";

describe("isNativeErpExpenseOrigin", () => {
  it.each(["sap", "erp", "sap_erp", " SAP "])("marks %s as native ERP", (origin) => {
    expect(isNativeErpExpenseOrigin(origin)).toBe(true);
  });

  it.each(["manual", "erp_flow", "pagcorp", null, undefined])(
    "keeps %s eligible for ERP integration",
    (origin) => {
      expect(isNativeErpExpenseOrigin(origin)).toBe(false);
    },
  );
});
