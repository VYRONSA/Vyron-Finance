import { describe, expect, it } from "vitest";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT, REQUIRED_ACTION_LOW_CONFIDENCE } from "@/server/accounting/matching-engine";
import { classifyForReview, computeStepStatuses, recommendedActionFor, suggestedActionFor } from "./transaction-review-classification";

describe("classifyForReview", () => {
  it("classifies a possible-duplicate payment ahead of everything else", () => {
    expect(classifyForReview({ requiredAction: REQUIRED_ACTION_DUPLICATE_PAYMENT, allocationStatus: "Suggested", reviewStatus: null }, [])).toBe("possibleDuplicate");
  });

  it("classifies an open PossibleDuplicate banking exception the same way", () => {
    expect(classifyForReview({ requiredAction: null, allocationStatus: "Matched", reviewStatus: null }, ["PossibleDuplicate"])).toBe("possibleDuplicate");
  });

  it("classifies an open LargeUnusualPayment exception as unusual", () => {
    expect(classifyForReview({ requiredAction: null, allocationStatus: "Unallocated", reviewStatus: null }, ["LargeUnusualPayment"])).toBe("unusual");
  });

  it("classifies any other required action as needing review", () => {
    expect(classifyForReview({ requiredAction: REQUIRED_ACTION_LOW_CONFIDENCE, allocationStatus: "Suggested", reviewStatus: null }, [])).toBe("needsReview");
  });

  it("classifies any other open exception as needing review", () => {
    expect(classifyForReview({ requiredAction: null, allocationStatus: "Unallocated", reviewStatus: null }, ["UnknownMerchant"])).toBe("needsReview");
  });

  it("classifies an unreviewed Suggested transaction as needing review even with no exception", () => {
    expect(classifyForReview({ requiredAction: null, allocationStatus: "Suggested", reviewStatus: null }, [])).toBe("needsReview");
  });

  it("classifies a Matched transaction as matched once it has no outstanding flags", () => {
    expect(classifyForReview({ requiredAction: null, allocationStatus: "Matched", reviewStatus: null }, [])).toBe("matched");
  });

  it("classifies an Allocated transaction as allocated once it has no outstanding flags", () => {
    expect(classifyForReview({ requiredAction: null, allocationStatus: "Allocated", reviewStatus: null }, [])).toBe("allocated");
  });

  it("classifies a plain Unallocated transaction as ready", () => {
    expect(classifyForReview({ requiredAction: null, allocationStatus: "Unallocated", reviewStatus: null }, [])).toBe("ready");
  });

  it("does not let a reviewed Suggested transaction fall into needsReview", () => {
    expect(classifyForReview({ requiredAction: null, allocationStatus: "Suggested", reviewStatus: "Approved" }, [])).toBe("ready");
  });
});

describe("computeStepStatuses", () => {
  it("starts every step upcoming except Upload, which is current, before anything is proven", () => {
    const result = computeStepStatuses({ hasUploaded: false, hasAnalysis: false, groupsLoaded: false, attentionCount: 0, reconciled: false });
    expect(result.upload).toBe("current");
    expect(result.analyse).toBe("upcoming");
    expect(result.review).toBe("upcoming");
    expect(result.allocate).toBe("upcoming");
    expect(result.reconcile).toBe("upcoming");
  });

  it("marks Upload and Analyse complete together once the existing system proves both at once", () => {
    const result = computeStepStatuses({ hasUploaded: true, hasAnalysis: true, groupsLoaded: false, attentionCount: 0, reconciled: false });
    expect(result.upload).toBe("complete");
    expect(result.analyse).toBe("complete");
    expect(result.review).toBe("current");
  });

  it("never marks Allocate complete while real transactions still need attention", () => {
    const result = computeStepStatuses({ hasUploaded: true, hasAnalysis: true, groupsLoaded: true, attentionCount: 3, reconciled: false });
    expect(result.review).toBe("complete");
    expect(result.allocate).toBe("current");
    expect(result.reconcile).toBe("upcoming");
  });

  it("marks Allocate complete only once the real attention count reaches zero", () => {
    const result = computeStepStatuses({ hasUploaded: true, hasAnalysis: true, groupsLoaded: true, attentionCount: 0, reconciled: false });
    expect(result.allocate).toBe("complete");
    expect(result.reconcile).toBe("current");
  });

  it("marks every step complete once reconciliation is proven", () => {
    const result = computeStepStatuses({ hasUploaded: true, hasAnalysis: true, groupsLoaded: true, attentionCount: 0, reconciled: true });
    expect(result.reconcile).toBe("complete");
  });
});

describe("suggestedActionFor", () => {
  it("prefers the real requiredAction text when present", () => {
    expect(suggestedActionFor({ requiredAction: "Review — possible duplicate payment", allocationReason: "", matchReason: "" })).toBe("Review — possible duplicate payment");
  });

  it("falls back to the real allocationReason when there is no requiredAction", () => {
    expect(suggestedActionFor({ requiredAction: null, allocationReason: "Matched on exact supplier name.", matchReason: "" })).toBe("Matched on exact supplier name.");
  });

  it("falls back to the real matchReason when there is no requiredAction or allocationReason", () => {
    expect(suggestedActionFor({ requiredAction: null, allocationReason: "", matchReason: "Matched on exact amount." })).toBe("Matched on exact amount.");
  });

  it("never fabricates a suggestion when nothing real is available", () => {
    expect(suggestedActionFor({ requiredAction: null, allocationReason: "", matchReason: "" })).toBe("No suggested action available yet.");
  });
});

describe("recommendedActionFor", () => {
  it("recommends reviewing a possible duplicate, opened in place", () => {
    expect(recommendedActionFor("possibleDuplicate", { allocationStatus: "Suggested", ruleId: null }, "co_1")).toEqual({ label: "Review Possible Duplicate", kind: "open-detail" });
  });

  it("recommends reviewing an unusual payment, opened in place", () => {
    expect(recommendedActionFor("unusual", { allocationStatus: "Unallocated", ruleId: null }, "co_1")).toEqual({ label: "Review Unusual Payment", kind: "open-detail" });
  });

  it("routes to Banking Rules when a rule fired but the transaction still needs review", () => {
    expect(recommendedActionFor("needsReview", { allocationStatus: "Suggested", ruleId: 7 }, "co_1")).toEqual({
      label: "Review Banking Rule",
      kind: "link",
      href: "/company/co_1/banking-rules",
    });
  });

  it("recommends matching a Suggested transaction with no rule involved, opened in place", () => {
    expect(recommendedActionFor("needsReview", { allocationStatus: "Suggested", ruleId: null }, "co_1")).toEqual({ label: "Match Transaction", kind: "open-detail" });
  });

  it("falls back to a generic review for any other needsReview case", () => {
    expect(recommendedActionFor("needsReview", { allocationStatus: "Unallocated", ruleId: null }, "co_1")).toEqual({ label: "Review transaction", kind: "open-detail" });
  });

  it("routes a clean Unallocated (Ready) transaction to the allocation workflow", () => {
    expect(recommendedActionFor("ready", { allocationStatus: "Unallocated", ruleId: null }, "co_1")).toEqual({
      label: "Allocate Transaction",
      kind: "link",
      href: "/company/co_1/transactions",
    });
  });
});
