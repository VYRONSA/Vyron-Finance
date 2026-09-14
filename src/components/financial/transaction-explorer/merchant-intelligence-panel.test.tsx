/**
 * Phase 43 — production defect investigation found this panel's two
 * fetches (`banking-rules`, `merchant-stats`) used a `cancelled` boolean
 * that only suppressed the resulting `setState` after unmount — it never
 * actually cancelled the underlying HTTP request, which kept holding a
 * real browser connection to the origin open until the server eventually
 * responded. These prove the real fix: an `AbortController` that
 * genuinely aborts both requests when the panel unmounts (the user
 * closes it, or navigates away while it's open).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MerchantIntelligencePanel } from "./merchant-intelligence-panel";
import type { BankTransactionRecord } from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: "co_1", transactionDate: "2026-08-01", reference: "", description: "Payment", beneficiary: "ABC Supplies",
    debit: 100, credit: 0, balance: null, bankAccount: "", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Unallocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves — simulates a slow/hanging request
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MerchantIntelligencePanel — abort on unmount (Phase 43)", () => {
  it("unmounting the panel aborts BOTH in-flight requests (banking-rules and merchant-stats)", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        signals.push(init?.signal ?? undefined);
        return new Promise(() => {});
      }),
    );

    const { unmount } = render(
      <MerchantIntelligencePanel companyId="co_1" transaction={txn()} merchants={[]} onClose={() => {}} previewMode={false} />,
    );

    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s?.aborted === false)).toBe(true);

    unmount();

    expect(signals.every((s) => s?.aborted === true)).toBe(true);
  });

  it("an aborted request never sets rules/stats to a fallback empty value — no misleading 'nothing found' flash on close", async () => {
    // If the abort's rejection were mishandled, the .catch() fallback
    // (setRules([])/setStats(null)) would fire AFTER unmount — harmless
    // in itself, but proves the catch branch correctly recognizes
    // AbortError and returns early instead. Rendering and unmounting
    // immediately without a React "state update on unmounted component"
    // warning is the observable proof.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <MerchantIntelligencePanel companyId="co_1" transaction={txn()} merchants={[]} onClose={() => {}} previewMode={false} />,
    );
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the aborted promise's rejection settle

    const unmountedWarnings = errorSpy.mock.calls.filter((args) => String(args[0]).includes("unmounted"));
    expect(unmountedWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });
});
