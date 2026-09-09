import { describe, expect, it } from "vitest";
import { resolveVatApprovalAuditReason } from "./vat-return-service";

// Master Implementation Tracker — Epic E1, Root Cause RC-2, Finding #201.
describe("resolveVatApprovalAuditReason", () => {
  it("claims the journal posted only when it actually did", () => {
    expect(resolveVatApprovalAuditReason(42, undefined, { ok: true })).toBe("Settlement journal posted to VAT Control.");
  });

  it("never claims posted when the Posting Engine skipped the journal — uses the real skip reason", () => {
    expect(resolveVatApprovalAuditReason(undefined, "Financial period is closed.", { ok: true })).toBe("Financial period is closed.");
  });

  it("falls back to the settlement-line build failure reason when the journal was never even built", () => {
    expect(resolveVatApprovalAuditReason(undefined, undefined, { ok: false, reason: "VAT Input / VAT Output balances are both zero." })).toBe(
      "VAT Input / VAT Output balances are both zero.",
    );
  });

  it("never fabricates a specific reason it doesn't actually have", () => {
    expect(resolveVatApprovalAuditReason(undefined, undefined, { ok: true })).toBe("Settlement journal was not posted.");
  });
});
