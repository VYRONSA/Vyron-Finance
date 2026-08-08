import { describe, expect, it } from "vitest";
import { computeMatchStatus } from "./transaction-grid";
import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";
import type { BankTransactionRecord } from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord>): BankTransactionRecord {
  return {
    id: 1, companyId: "c1", transactionDate: "2026-08-01", reference: "", description: "", beneficiary: "Checkers",
    debit: 100, credit: 0, balance: null, bankAccount: "", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00Z",
    allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null,
    confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "",
    isManualOverride: false, reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null,
    journalId: null, matchedCustomerId: null, matchedMerchantId: null, ruleId: null,
    allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null,
    cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false,
    ...overrides,
  };
}

// Pilot Review Board follow-up — "the accountant should instantly see
// the status" via a precedence-ordered colour system. These tests lock
// in the documented precedence order in `computeMatchStatus` itself.
describe("computeMatchStatus", () => {
  it("Invalid wins over every other signal when the row is touched and incomplete", () => {
    const t = txn({ requiredAction: REQUIRED_ACTION_DUPLICATE_PAYMENT, ruleId: 1 });
    expect(computeMatchStatus(t, true, true)).toEqual({ label: "Invalid", tone: "danger" });
  });

  it("an untouched row is never marked Invalid even if it would otherwise qualify", () => {
    const t = txn({});
    expect(computeMatchStatus(t, false, true)).not.toEqual({ label: "Invalid", tone: "danger" });
  });

  it("Duplicate outranks Needs Review and Rule Created", () => {
    const t = txn({ requiredAction: REQUIRED_ACTION_DUPLICATE_PAYMENT, ruleId: 1 });
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Duplicate", tone: "muted" });
  });

  it("Needs Review outranks Rule Created", () => {
    const t = txn({ requiredAction: "Review — confidence below auto-match threshold", ruleId: 1 });
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Needs Review", tone: "critical" });
  });

  it("Rule Created shows when a rule resolved the row and nothing more urgent applies", () => {
    const t = txn({ ruleId: 5, allocationStatus: "Allocated" });
    expect(computeMatchStatus(t, false, false)).toEqual({ label: "Rule Created", tone: "info" });
  });

  it("Matched is green", () => {
    expect(computeMatchStatus(txn({ allocationStatus: "Matched" }), false, false)).toEqual({ label: "Matched", tone: "good" });
  });

  it("Suggested is yellow/warn", () => {
    expect(computeMatchStatus(txn({ allocationStatus: "Suggested" }), false, false)).toEqual({ label: "Suggested", tone: "warn" });
  });

  it("Allocated (no rule) is green", () => {
    expect(computeMatchStatus(txn({ allocationStatus: "Allocated" }), false, false)).toEqual({ label: "Allocated", tone: "good" });
  });

  it("falls back to Unallocated/grey with no signals", () => {
    expect(computeMatchStatus(txn({}), false, false)).toEqual({ label: "Unallocated", tone: "muted" });
  });
});
