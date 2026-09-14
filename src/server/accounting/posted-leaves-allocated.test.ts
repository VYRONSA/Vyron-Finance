/**
 * PRODUCTION DEFECT — "After posted it must not still show under
 * Allocated. It must be under posted."
 *
 * The page footer read:
 *
 *   Allocated 50 | ... | Unprocessed 0 | Ready to Post 48 | Posted 2
 *
 * and the 2 posted transactions were inside the 50 as well as inside the
 * Posted 2. Ticking the "Allocated" chip listed them too. Allocation
 * status and posting status are genuinely separate axes for most of the
 * workflow — but POSTING IS TERMINAL, and once a transaction is in the
 * General Ledger, "Allocated" is not where an accountant looks for it.
 * Counting it in both buckets overstates what is left to do.
 */
import { describe, expect, it } from "vitest";
import {
  allocationFilterExcludesPosted,
  countsAsAllocated,
  transactionPostingStatus,
  type BankTransactionRecord,
} from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: "co_1", transactionDate: "2026-08-31", reference: "", description: "FNB OB Pmt",
    beneficiary: "Food Sev Solutions", debit: 1455.44, credit: 0, balance: null, bankAccount: "62050837304", bankAccountId: 1,
    glAccount: "", vat: null, notes: "", importBatch: "XERO", sourceFilename: "bank.xlsx",
    createdAt: "2026-09-09T00:00:00Z", allocationStatus: "Allocated", matchedSupplierId: 516, matchedSupplierName: null,
    matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: "Manual", allocationReason: "", isManualOverride: true,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null,
    matchedMerchantId: null, ruleId: null, allocationType: "S", allocationNotes: "", entrySource: "Imported",
    captureStatus: null, cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false,
    postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false,
    reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: true,
    overrideSupplierInvoiceMatchingBy: "accountant@vyron", overrideSupplierInvoiceMatchingAt: "2026-09-10T09:00:00Z",
    ...overrides,
  };
}

describe("1. a posted transaction leaves the Allocated count", () => {
  it("posted — no longer counted as Allocated", () => {
    expect(countsAsAllocated(txn({ postedFlag: true }))).toBe(false);
    expect(transactionPostingStatus(txn({ postedFlag: true }))).toBe("Posted");
  });

  it("reconciled — same, since reconciled implies posted", () => {
    expect(countsAsAllocated(txn({ postedFlag: true, reconciliationId: 4 }))).toBe(false);
    expect(countsAsAllocated(txn({ reconciliationId: 4 }))).toBe(false);
  });

  it("still unposted — still counted as Allocated", () => {
    expect(countsAsAllocated(txn())).toBe(true);
  });

  it("a Matched transaction counts as allocated work until it posts", () => {
    expect(countsAsAllocated(txn({ allocationStatus: "Matched" }))).toBe(true);
    expect(countsAsAllocated(txn({ allocationStatus: "Matched", postedFlag: true }))).toBe(false);
  });

  it("Suggested and Unallocated never counted, posted or not", () => {
    for (const allocationStatus of ["Suggested", "Unallocated"] as const) {
      expect(countsAsAllocated(txn({ allocationStatus }))).toBe(false);
      expect(countsAsAllocated(txn({ allocationStatus, postedFlag: true }))).toBe(false);
    }
  });

  it("the reported page adds up: the buckets partition instead of overlapping", () => {
    // 48 allocated-and-unposted + 2 posted — the exact shape from the
    // screenshot, which previously reported Allocated 50 alongside Posted 2.
    const page = [...Array(48)].map((_, i) => txn({ id: i + 1 })).concat([txn({ id: 49, postedFlag: true }), txn({ id: 50, postedFlag: true })]);
    const allocated = page.filter(countsAsAllocated).length;
    const posted = page.filter((t) => transactionPostingStatus(t) === "Posted").length;
    expect(allocated).toBe(48);
    expect(posted).toBe(2);
    expect(allocated + posted).toBe(page.length);
  });
});

describe("2. the Allocated filter hides posted rows — unless they were asked for", () => {
  it("no posting-status filter → posted rows are excluded", () => {
    expect(allocationFilterExcludesPosted({ postingStatuses: null })).toBe(true);
    expect(allocationFilterExcludesPosted({ postingStatuses: [] })).toBe(true);
  });

  it("filtering the posting axis to unposted states → still excluded", () => {
    expect(allocationFilterExcludesPosted({ postingStatuses: ["Ready to Post"] })).toBe(true);
    expect(allocationFilterExcludesPosted({ postingStatuses: ["Unprocessed", "Ready to Post"] })).toBe(true);
  });

  it("explicitly asking for Posted → honoured, not silently emptied", () => {
    // Ticking "Allocated" AND "Posted" is a deliberate request to see
    // both; returning nothing would be worse than the overlap this fixes.
    expect(allocationFilterExcludesPosted({ postingStatuses: ["Posted"] })).toBe(false);
    expect(allocationFilterExcludesPosted({ postingStatuses: ["Allocated" as never, "Posted"] })).toBe(false);
  });

  it("explicitly asking for Reconciled → honoured too", () => {
    expect(allocationFilterExcludesPosted({ postingStatuses: ["Reconciled"] })).toBe(false);
  });
});
