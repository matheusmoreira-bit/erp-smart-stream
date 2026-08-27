import { describe, expect, it } from "vitest";

import { isAttachmentRequiredForDocument } from "./attachment-validation";

describe("isAttachmentRequiredForDocument", () => {
  it("allows sales orders without attachments", () => {
    expect(isAttachmentRequiredForDocument("sales")).toBe(false);
  });

  it("keeps attachments required for purchases and unknown document types", () => {
    expect(isAttachmentRequiredForDocument("purchase")).toBe(true);
    expect(isAttachmentRequiredForDocument(undefined)).toBe(true);
  });
});
