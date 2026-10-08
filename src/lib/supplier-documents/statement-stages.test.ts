/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { canLinkItem, explanationTarget, readinessBlockers, statementStage, STATEMENT_STAGES, type ReconItemView } from "./statement-stages";

const item = (p: Partial<ReconItemView>): ReconItemView => ({
  order: 1, statementLineId: null, category: "Matched", subStatus: "exact", refType: null, refId: null, relatedRefs: [], explained: true, explainedByResolutionId: null, ...p,
});

describe("statement stages", () => {
  it("every status has exactly one stage, and every stage is listed", () => {
    const statuses = ["Queued", "Processing", "ManualEntry", "NeedsReview", "Ready", "Reconciled", "Duplicate", "Failed", "Rejected"] as const;
    const keys = new Set(STATEMENT_STAGES.map((s) => s.key));
    for (const s of statuses) expect(keys.has(statementStage(s))).toBe(true);
    expect(statementStage("Failed")).toBe("to-enter");
    expect(statementStage("Duplicate")).toBe("closed");
  });
});

describe("readinessBlockers", () => {
  const ok = { status: "NeedsReview" as const, validationStatus: "Pass", supplierId: 1, supplierConfirmed: true, currencySupported: true, unreadLines: 0, statementDate: "2026-09-30" };
  it("none when everything is in place", () => expect(readinessBlockers(ok)).toEqual([]));
  it("a proposed supplier is not enough — confirmation is required", () => {
    expect(readinessBlockers({ ...ok, supplierConfirmed: false }).join(" ")).toMatch(/Confirm the supplier/);
  });
  it("lists every reason the database would refuse", () => {
    const all = readinessBlockers({ ...ok, validationStatus: "Incomplete", supplierId: null, supplierConfirmed: false, currencySupported: false, unreadLines: 2, statementDate: null });
    expect(all).toHaveLength(5);
    expect(all.join(" ")).toMatch(/Unsupported currency — manual review required/);
  });
});

describe("reconciliation actions", () => {
  it("an explanation names the line, the opening difference, or the record", () => {
    expect(explanationTarget(item({ statementLineId: 4 }))).toEqual({ statementLineId: 4 });
    expect(explanationTarget(item({ category: "Opening Balance Difference" }))).toEqual({ refType: "opening-difference" });
    expect(explanationTarget(item({ category: "Missing on Statement", refType: "bill", refId: 9 }))).toEqual({ refType: "bill", refId: 9 });
    expect(explanationTarget(item({ category: "Potential Duplicate", relatedRefs: [{ refType: "supplier-payment", refId: 3 }, { refType: "bank-transaction", refId: 4 }] }))).toEqual({ refType: "supplier-payment", refId: 3 });
    expect(explanationTarget(item({ category: "Missing in PRECISIA", refType: "capture", refId: 2 }))).toBeNull();
  });
  it("only unmatched statement lines can be linked by hand", () => {
    expect(canLinkItem(item({ statementLineId: 1, category: "Missing in PRECISIA", subStatus: "not-captured" }))).toBe(true);
    expect(canLinkItem(item({ statementLineId: 1, category: "Matched" }))).toBe(false);
    expect(canLinkItem(item({ statementLineId: 1, category: "Payment", subStatus: "matched" }))).toBe(false);
    expect(canLinkItem(item({ statementLineId: 1, category: "Payment", subStatus: "suggested" }))).toBe(true);
    expect(canLinkItem(item({ statementLineId: null, category: "Missing on Statement" }))).toBe(false);
  });
});
