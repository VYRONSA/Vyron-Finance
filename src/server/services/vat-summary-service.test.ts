import { describe, expect, it } from "vitest";
import { buildVatDashboardSummary, computeComplianceScore } from "./vat-summary-service";
import type { VatException, VatReturn } from "@/server/vat/types";

function vatReturn(overrides: Partial<VatReturn> & { id: number }): VatReturn {
  return {
    companyId: "co_1", periodStart: "2026-06-01", periodEnd: "2026-06-30", status: "Draft",
    totalOutputVat: 0, totalInputVat: 0, netPayable: 0, settlementJournalId: null,
    isAmendment: false, amendedReturnId: null, sarsReference: null, submissionMethod: "Manual",
    submittedAt: null, approvedBy: null, approvedAt: null, notes: "", generatedAt: "2026-07-01T00:00:00Z", generatedBy: "System",
    ...overrides,
  };
}

function vatException(overrides: Partial<VatException> & { id: number }): VatException {
  return {
    companyId: "co_1", exceptionType: "IncorrectVatCode", documentType: "SupplierBill", documentId: 1,
    reason: "", evidence: "", recommendedAction: "", status: "Open",
    resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildVatDashboardSummary", () => {
  it("reports a positive net payable as VAT Payable, zero receivable", () => {
    const summary = buildVatDashboardSummary(vatReturn({ id: 1, netPayable: 5000 }), [], [], 0);
    expect(summary.vatPayable).toBe(5000);
    expect(summary.vatReceivable).toBe(0);
  });

  it("reports a negative net payable as VAT Receivable, zero payable", () => {
    const summary = buildVatDashboardSummary(vatReturn({ id: 1, netPayable: -1200 }), [], [], 0);
    expect(summary.vatReceivable).toBe(1200);
    expect(summary.vatPayable).toBe(0);
  });

  it("reports zero for both when there is no latest return", () => {
    const summary = buildVatDashboardSummary(null, [], [], 0);
    expect(summary.vatPayable).toBe(0);
    expect(summary.vatReceivable).toBe(0);
  });

  it("counts Draft returns and open exceptions", () => {
    const summary = buildVatDashboardSummary(
      null,
      [vatReturn({ id: 1, status: "Draft" }), vatReturn({ id: 2, status: "Submitted" })],
      [vatException({ id: 1 }), vatException({ id: 2, status: "Resolved" })],
      0,
    );
    expect(summary.draftReturnCount).toBe(1);
    expect(summary.openExceptionCount).toBe(1);
  });
});

describe("computeComplianceScore", () => {
  it("is 100 with no open exceptions and no draft returns", () => {
    expect(computeComplianceScore([], 0)).toBe(100);
  });

  it("deducts more for higher-severity exception types", () => {
    const lowSeverity = computeComplianceScore([vatException({ id: 1, exceptionType: "MissingVatNumber" })], 0);
    const highSeverity = computeComplianceScore([vatException({ id: 1, exceptionType: "DuplicateVatClaim" })], 0);
    expect(highSeverity).toBeLessThan(lowSeverity);
  });

  it("never goes below zero", () => {
    const manyExceptions = Array.from({ length: 50 }, (_, i) => vatException({ id: i, exceptionType: "DuplicateVatClaim" }));
    expect(computeComplianceScore(manyExceptions, 10)).toBe(0);
  });

  it("deducts for each draft return awaiting action", () => {
    expect(computeComplianceScore([], 3)).toBe(94);
  });
});
