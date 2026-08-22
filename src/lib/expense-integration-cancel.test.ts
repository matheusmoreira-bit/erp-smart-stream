import { describe, expect, it } from "vitest";
import {
  MANUAL_EXPENSE_CANCEL_FLAG,
  isManualCancellationPayload,
} from "../../supabase/functions/_shared/expense-integration-cancel";

describe("isManualCancellationPayload", () => {
  it("recognizes the persistent manual cancellation marker", () => {
    expect(isManualCancellationPayload({ [MANUAL_EXPENSE_CANCEL_FLAG]: true })).toBe(true);
  });

  it.each([
    { [MANUAL_EXPENSE_CANCEL_FLAG]: false },
    {},
    null,
    "invalid",
  ])("does not block retries for %j", (payload) => {
    expect(isManualCancellationPayload(payload)).toBe(false);
  });
});
