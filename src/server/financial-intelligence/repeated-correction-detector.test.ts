import { describe, expect, it } from "vitest";
import { detectRepeatedCorrectionPatterns } from "./repeated-correction-detector";
import type { BankTransactionRecord } from "@/server/accounting/types";

let nextId = 1;
function transaction(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: nextId++, companyId: "company-a", transactionDate: "2026-08-01", reference: "REF", description: "", beneficiary: "ABC Supplies",
    debit: 500, credit: 0, balance: null, bankAccount: "Cheque Account", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Allocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: "6100", suggestedVatCode: null, allocationMethod: "Manual", allocationReason: "", isManualOverride: true,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null,
    ...overrides,
  };
}

function manualSeries(count: number, overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord[] {
  return Array.from({ length: count }, (_, i) => transaction({ transactionDate: `2026-0${i + 1}-01`, ...overrides }));
}

describe("detectRepeatedCorrectionPatterns", () => {
  it("produces no finding for only 2 repeated allocations (edge case 1)", () => {
    expect(detectRepeatedCorrectionPatterns(manualSeries(2))).toEqual([]);
  });

  it("flags a pattern at exactly 3 repeated allocations (edge case 2)", () => {
    const patterns = detectRepeatedCorrectionPatterns(manualSeries(3));
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrenceCount).toBe(3);
    expect(patterns[0].beneficiary).toBe("ABC Supplies");
    expect(patterns[0].glAccount).toBe("6100");
  });

  it("flags a pattern at 4 or more repeated allocations (edge case 3)", () => {
    const patterns = detectRepeatedCorrectionPatterns(manualSeries(5));
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrenceCount).toBe(5);
  });

  it("treats the same beneficiary allocated to different GL accounts as separate patterns (edge case 4)", () => {
    const transactions = [...manualSeries(3, { suggestedGlAccount: "6100" }), ...manualSeries(3, { suggestedGlAccount: "6200" })];
    const patterns = detectRepeatedCorrectionPatterns(transactions);
    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.glAccount).sort()).toEqual(["6100", "6200"]);
  });

  it("treats different beneficiaries allocated to the same GL account as separate patterns (edge case 5)", () => {
    const transactions = [...manualSeries(3, { beneficiary: "ABC Supplies" }), ...manualSeries(3, { beneficiary: "XYZ Traders" })];
    const patterns = detectRepeatedCorrectionPatterns(transactions);
    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.beneficiary).sort()).toEqual(["ABC Supplies", "XYZ Traders"]);
  });

  it("only counts genuinely manual allocations as evidence (edge case 6)", () => {
    const patterns = detectRepeatedCorrectionPatterns(manualSeries(3, { isManualOverride: true, ruleId: null, allocationMethod: "Manual" }));
    expect(patterns).toHaveLength(1);
  });

  it("excludes rule-created allocations from the evidence, even with a matching beneficiary/GL (edge case 7)", () => {
    const transactions = [...manualSeries(2), ...manualSeries(3, { ruleId: 42, isManualOverride: false })];
    // Only 2 genuine manual allocations remain — below threshold.
    expect(detectRepeatedCorrectionPatterns(transactions)).toEqual([]);
  });

  it("excludes AI-classified allocations from the evidence (edge case 8)", () => {
    const transactions = [...manualSeries(2), ...manualSeries(3, { allocationMethod: "Future AI", isManualOverride: false })];
    expect(detectRepeatedCorrectionPatterns(transactions)).toEqual([]);
  });

  it("counts a manual allocation whose allocationMethod is null (most manual bulk-assigns don't set it) as genuine evidence", () => {
    const patterns = detectRepeatedCorrectionPatterns(manualSeries(3, { allocationMethod: null, isManualOverride: true, ruleId: null }));
    expect(patterns).toHaveLength(1);
  });

  it("is a pure function that never mutates or writes to its input transactions (edge case 9 — no possible posted-transaction modification)", () => {
    const transactions = manualSeries(3);
    const snapshot = JSON.parse(JSON.stringify(transactions));
    detectRepeatedCorrectionPatterns(transactions);
    expect(transactions).toEqual(snapshot);
  });

  it("only considers the transactions it's given — proven at the pure-function boundary (edge case 10, multiple companies)", () => {
    const companyA = manualSeries(3, { companyId: "company-a", beneficiary: "A Corp" });
    const companyB = manualSeries(3, { companyId: "company-b", beneficiary: "B Corp" });
    const patternsA = detectRepeatedCorrectionPatterns(companyA);
    const patternsB = detectRepeatedCorrectionPatterns(companyB);
    expect(patternsA[0].beneficiary).toBe("A Corp");
    expect(patternsB[0].beneficiary).toBe("B Corp");
  });

  it("never forms a pattern from a missing/empty beneficiary (edge case 11)", () => {
    expect(detectRepeatedCorrectionPatterns(manualSeries(3, { beneficiary: "" }))).toEqual([]);
    expect(detectRepeatedCorrectionPatterns(manualSeries(3, { beneficiary: "   " }))).toEqual([]);
  });

  it("never normalizes beneficiary case/whitespace — matches countBeneficiaryAllocations's own raw exact-match behavior (edge case 12)", () => {
    const transactions = [
      transaction({ beneficiary: "ABC Supplies" }),
      transaction({ beneficiary: "abc supplies" }),
      transaction({ beneficiary: " ABC Supplies " }),
    ];
    // All three are, byte-for-byte, different strings — the existing
    // inline helper's raw .eq("beneficiary", ...) would treat them as 3
    // distinct beneficiaries too, so no pattern forms from only 1 of each.
    expect(detectRepeatedCorrectionPatterns(transactions)).toEqual([]);
  });

  it("requires a GL account to be present — a transaction with no suggestedGlAccount is never evidence", () => {
    expect(detectRepeatedCorrectionPatterns(manualSeries(3, { suggestedGlAccount: null }))).toEqual([]);
  });

  it("reports the most recent date and the full set of transaction ids", () => {
    const transactions = [
      transaction({ transactionDate: "2026-01-01" }),
      transaction({ transactionDate: "2026-03-01" }),
      transaction({ transactionDate: "2026-02-01" }),
    ];
    const [pattern] = detectRepeatedCorrectionPatterns(transactions);
    expect(pattern.latestDate).toBe("2026-03-01");
    expect(pattern.transactionIds).toHaveLength(3);
  });

  it("returns no patterns for an empty transaction history", () => {
    expect(detectRepeatedCorrectionPatterns([])).toEqual([]);
  });
});
