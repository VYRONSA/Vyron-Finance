/**
 * Phase 29A — forensic review finding: `applyAllocationPatch` (the
 * inline grid's optimistic local-state patch, used so a fast keyboard
 * "tab through the statement" flow never needs a full page refetch after
 * every row) had drifted out of sync with Phase 29's server-side fix to
 * `bulkAssignGl`/`bulkAssignSupplier`/`bulkAssignCustomer` — the server
 * now also writes `allocation_method: 'Manual'`, but this client-side
 * patch didn't, so `needsAiAcceptAction` (which gates on that exact
 * field) would have kept the Accept button showing for the rest of the
 * browser session after a real Accept/Save, only correcting itself on
 * the next full page load. Tested directly here — no component render
 * needed, this is a pure function.
 *
 * Phase 40, Live Defect 3 — a full `<TransactionExplorer>` render (to
 * prove the "+ Add Transaction"/Delete buttons are actually mounted, not
 * just present in source) was attempted here and crashed the vitest
 * worker process — TanStack Table/Virtual's `TransactionGrid` child
 * needs DOM measurement APIs (ResizeObserver, layout) jsdom doesn't
 * provide, the SAME documented constraint `transaction-grid.tsx`'s own
 * `buildAccountCodeOptions` extraction already exists to work around
 * (see that function's doc comment). Rather than leave an unstable,
 * crash-prone test in the suite, this stays pure-function-only; "+ Add
 * Transaction" and Delete are covered by direct source verification
 * (Phase 40's own investigation) and the isolated, stable component
 * tests in `transaction-bulk-action-bar.test.tsx` and
 * `add-transaction-form.tsx` — plus live production route/UI
 * verification after deployment, which is the one check no unit test
 * can substitute for.
 */
import { describe, expect, it } from "vitest";
import { applyAllocationPatch, beginTrackedFetch, formatDuplicateRuleMessage, isCurrentFetch, type DuplicateRuleInfo } from "./transaction-explorer";
import { needsAiAcceptAction } from "./transaction-grid";
import type { BankTransactionRecord, Supplier } from "@/server/accounting/types";
import type { AllocateRowPayload } from "./transaction-grid";
import type { Merchant } from "@/server/banking-rules/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 501, companyId: "company-a", transactionDate: "2026-08-01", reference: "", description: "PICK N PAY", beneficiary: "Pick n Pay",
    debit: 1245.6, credit: 0, balance: null, bankAccount: "Cheque Account", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Unallocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null,
    ...overrides,
  };
}

const glCommit: AllocateRowPayload = { type: "G", accountCode: "6940", supplierId: null, customerId: null, vatCode: "STD", allocationNotes: "", description: null };

describe("applyAllocationPatch (Phase 29A)", () => {
  it("sets allocationMethod to Manual, matching the server-side bulkAssignGl fix — the same-session Accept-button-disappears requirement", () => {
    const before = txn({ suggestedGlAccount: "6940", allocationStatus: "Suggested", allocationMethod: "Future AI", isManualOverride: false });
    const after = applyAllocationPatch(before, glCommit);

    expect(after.allocationMethod).toBe("Manual");
    expect(after.allocationStatus).toBe("Allocated");
    expect(after.isManualOverride).toBe(true);
  });

  it("the exact regression this fix closes: needsAiAcceptAction is false IMMEDIATELY after the patch, not only after a page refresh", () => {
    const beforeAccept = txn({ suggestedGlAccount: "6940", allocationStatus: "Suggested", allocationMethod: "Future AI", isManualOverride: false });
    expect(needsAiAcceptAction(beforeAccept)).toBe(true);

    const afterAccept = applyAllocationPatch(beforeAccept, glCommit);
    expect(needsAiAcceptAction(afterAccept)).toBe(false);
  });

  it("works identically for a genuinely Unallocated transaction being manually allocated for the first time", () => {
    const before = txn({ suggestedGlAccount: null, allocationStatus: "Unallocated", allocationMethod: null, isManualOverride: false });
    const after = applyAllocationPatch(before, glCommit);

    expect(after.allocationMethod).toBe("Manual");
    expect(after.allocationStatus).toBe("Allocated");
    expect(needsAiAcceptAction(after)).toBe(false);
  });

  it("never changes company_id, transaction id, or the debit/credit amount", () => {
    const before = txn({ id: 501, companyId: "company-a", debit: 1245.6, credit: 0 });
    const after = applyAllocationPatch(before, glCommit);

    expect(after.id).toBe(501);
    expect(after.companyId).toBe("company-a");
    expect(after.debit).toBe(1245.6);
    expect(after.credit).toBe(0);
  });

  // Phase 31A — item 5: a saved description must be reflected in local
  // state immediately (the same optimistic-patch reasoning `notes`/GL
  // already get), not only after the next full page refetch.
  it("patches the description when the commit included a real, changed description", () => {
    const before = txn({ description: "FNB OB Pmt FNB OB 000024505 Ren Remuneration" });
    const after = applyAllocationPatch(before, { ...glCommit, description: "Ren Remuneration" });
    expect(after.description).toBe("Ren Remuneration");
  });

  it("leaves the local description untouched when the commit's description is null (unchanged) — never overwrites with a stale/empty value", () => {
    const before = txn({ description: "FNB OB Pmt FNB OB 000024505 Ren Remuneration" });
    const after = applyAllocationPatch(before, { ...glCommit, description: null });
    expect(after.description).toBe("FNB OB Pmt FNB OB 000024505 Ren Remuneration");
  });
});

function supplierFixture(overrides: Partial<Supplier> & Pick<Supplier, "id" | "name">): Supplier {
  return {
    companyId: "co_1", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "", bankAccountNumber: "",
    bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 0, spendingLimit: 0,
    ...overrides,
  };
}

// Phase 41, Part 2/4 — "STOP and explain" message for a rejected
// duplicate rule. Exercises the exact scenario from the live production
// incident: "Description contains Fish → Supplier: Three Streams FISH".
describe("formatDuplicateRuleMessage (Phase 41)", () => {
  const suppliers = [supplierFixture({ id: 636, name: "Three Streams FISH" })];
  const customers: { id: number; name: string }[] = [];
  const merchants: Merchant[] = [];

  it("names the existing rule by id and describes its condition and Supplier action, matching the live scenario", () => {
    const rule: DuplicateRuleInfo = {
      id: 9,
      name: "Auto: Fish → Supplier",
      conditions: [{ field: "description", operator: "contains", value: "Fish" }],
      actions: [{ actionType: "set_supplier", targetId: 636, targetText: null }],
    };
    const message = formatDuplicateRuleMessage(rule, suppliers, customers, merchants);

    expect(message).toContain("Duplicate Banking Rule");
    expect(message).toContain('Description contains "Fish"');
    expect(message).toContain("Supplier: Three Streams FISH");
    expect(message).toContain("Existing Rule: #9");
    expect(message).toContain("was not created");
  });

  it("describes a GL action by its target text (account code), not a supplier lookup", () => {
    const rule: DuplicateRuleInfo = {
      id: 5,
      name: "Auto: Bank Charge → GL",
      conditions: [{ field: "description", operator: "contains", value: "Bank Charge" }],
      actions: [{ actionType: "set_gl_account", targetId: null, targetText: "6100" }],
    };
    const message = formatDuplicateRuleMessage(rule, suppliers, customers, merchants);
    expect(message).toContain("GL Account: 6100");
  });

  it("falls back to a bare id when the target supplier isn't in the loaded list", () => {
    const rule: DuplicateRuleInfo = {
      id: 11,
      name: "Auto: X → Supplier",
      conditions: [{ field: "description", operator: "contains", value: "X" }],
      actions: [{ actionType: "set_supplier", targetId: 999, targetText: null }],
    };
    const message = formatDuplicateRuleMessage(rule, suppliers, customers, merchants);
    expect(message).toContain("Supplier: #999");
  });
});

// -----------------------------------------------------------------------
// Phase 43 — production defect: `fetchPage` had no request cancellation
// at all (23+ fetch call sites in Transaction Explorer, zero
// AbortController usage anywhere). Rendering the full `<TransactionExplorer>`
// to test this end-to-end crashes the jsdom test worker (a deeper
// instability than Phase 42's virtualization fix resolves — confirmed by
// direct attempt, not assumed) — so, matching `transaction-grid.tsx`'s
// own `buildAccountCodeOptions` precedent for the identical constraint,
// the race-prevention DECISION LOGIC was extracted into two small,
// directly testable functions (`beginTrackedFetch`/`isCurrentFetch`) and
// is tested here without needing to render the grid at all.
// -----------------------------------------------------------------------
describe("beginTrackedFetch / isCurrentFetch — fetch race prevention (Phase 43)", () => {
  it("aborts the previous controller when a new fetch begins", () => {
    const ref: { current: AbortController | null } = { current: null };
    const first = beginTrackedFetch(ref);
    expect(first.signal.aborted).toBe(false);

    const second = beginTrackedFetch(ref);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(ref.current).toBe(second);
  });

  it("the very first call has nothing to abort and still tracks correctly", () => {
    const ref: { current: AbortController | null } = { current: null };
    const controller = beginTrackedFetch(ref);
    expect(ref.current).toBe(controller);
    expect(controller.signal.aborted).toBe(false);
  });

  it("isCurrentFetch is true only for the MOST RECENT controller — a stale one must never apply its result", () => {
    const ref: { current: AbortController | null } = { current: null };
    const stale = beginTrackedFetch(ref);
    const fresh = beginTrackedFetch(ref);

    expect(isCurrentFetch(ref, stale)).toBe(false);
    expect(isCurrentFetch(ref, fresh)).toBe(true);
  });

  it("the exact race this fixes: three rapid filter changes — only the LAST controller is ever current, and every earlier one is aborted", () => {
    const ref: { current: AbortController | null } = { current: null };
    const controllers = [beginTrackedFetch(ref), beginTrackedFetch(ref), beginTrackedFetch(ref)];

    controllers.forEach((c, i) => {
      expect(c.signal.aborted).toBe(i < controllers.length - 1); // every one except the last is aborted
      expect(isCurrentFetch(ref, c)).toBe(i === controllers.length - 1); // only the last is "current"
    });
  });
});
