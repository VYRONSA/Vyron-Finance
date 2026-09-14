import { describe, expect, it } from "vitest";
import {
  hasGlAssignmentChanged,
  hasSupplierAssignmentChanged,
  hasCustomerAssignmentChanged,
  hasVatAssignmentChanged,
  hasVatRecodeChanged,
  hasMerchantAssignmentChanged,
  computeBlockedIds,
  buildAllocateRowFinalUpdate,
  isDuplicateNaturalKey,
} from "./transaction-explorer-repository";
import { needsAiAcceptAction, computeMatchStatus } from "@/components/financial/transaction-explorer/transaction-grid";
import type { BankTransactionRecord } from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 501, companyId: "company-a", transactionDate: "2026-08-01", reference: "", description: "PICK N PAY", beneficiary: "Pick n Pay",
    debit: 1245.6, credit: 0, balance: null, bankAccount: "Cheque Account", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Unallocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

// Phase 29 — "Never create duplicate allocation history entries for a
// no-op save." These predicates gate whether `bulkUpdateWithAllocationHistory`
// writes an `ae_allocation_history` row at all — pure, exported, and
// tested directly here (no Supabase client involved) rather than only
// via integration, matching this codebase's own convention of unit
// testing extracted decision logic.
describe("hasGlAssignmentChanged (Phase 29)", () => {
  it("true for a genuinely Unallocated row being assigned a GL account for the first time", () => {
    const previous = txn({ suggestedGlAccount: null, allocationStatus: "Unallocated", allocationMethod: null, isManualOverride: false });
    expect(hasGlAssignmentChanged(previous, "6100")).toBe(true);
  });

  it("true when the GL account itself differs, even if status/method/override already look settled", () => {
    const previous = txn({ suggestedGlAccount: "6200", allocationStatus: "Allocated", allocationMethod: "Manual", isManualOverride: true });
    expect(hasGlAssignmentChanged(previous, "6100")).toBe(true);
  });

  it("true for an AI-suggested row being Accepted verbatim — the account code is unchanged, but status/method/override are not yet settled", () => {
    const previous = txn({ suggestedGlAccount: "6100", allocationStatus: "Suggested", allocationMethod: "Future AI", isManualOverride: false });
    expect(hasGlAssignmentChanged(previous, "6100")).toBe(true);
  });

  it("false only when the account AND status AND method AND override are already exactly settled — a genuine no-op re-save", () => {
    const previous = txn({ suggestedGlAccount: "6100", allocationStatus: "Allocated", allocationMethod: "Manual", isManualOverride: true });
    expect(hasGlAssignmentChanged(previous, "6100")).toBe(false);
  });
});

describe("hasSupplierAssignmentChanged (Phase 29)", () => {
  it("true for a first-time supplier assignment", () => {
    const previous = txn({ matchedSupplierId: null, allocationStatus: "Unallocated", allocationMethod: null, isManualOverride: false });
    expect(hasSupplierAssignmentChanged(previous, 7)).toBe(true);
  });

  it("false for a genuine no-op re-save (same supplier, already settled)", () => {
    const previous = txn({ matchedSupplierId: 7, allocationStatus: "Allocated", allocationMethod: "Manual", isManualOverride: true });
    expect(hasSupplierAssignmentChanged(previous, 7)).toBe(false);
  });
});

describe("hasCustomerAssignmentChanged (Phase 29)", () => {
  it("true for a first-time customer assignment", () => {
    const previous = txn({ matchedCustomerId: null, allocationStatus: "Unallocated", allocationMethod: null, isManualOverride: false });
    expect(hasCustomerAssignmentChanged(previous, 8)).toBe(true);
  });

  it("false for a genuine no-op re-save (same customer, already settled)", () => {
    const previous = txn({ matchedCustomerId: 8, allocationStatus: "Allocated", allocationMethod: "Manual", isManualOverride: true });
    expect(hasCustomerAssignmentChanged(previous, 8)).toBe(false);
  });
});

// VAT-only assignment deliberately does NOT consider allocation_status/
// allocation_method/is_manual_override (see `bulkAssignVat`'s own
// docstring) — only whether the VAT code itself actually changed.
describe("hasVatAssignmentChanged (Phase 29)", () => {
  it("true when the VAT code differs", () => {
    expect(hasVatAssignmentChanged(txn({ suggestedVatCode: "STD" }), "ZERO")).toBe(true);
  });

  it("false when re-saving the identical VAT code, regardless of allocation_status/method/override", () => {
    const previous = txn({ suggestedVatCode: "STD", allocationStatus: "Suggested", allocationMethod: "Future AI", isManualOverride: false });
    expect(hasVatAssignmentChanged(previous, "STD")).toBe(false);
  });
});

// Find & Recode's VAT recode DOES also assert allocation_method/
// is_manual_override (that path always sets `allocation_method: 'Manual'`
// even for a VAT-only recode — see `bulkRecodeVat`) — a distinct
// predicate from `hasVatAssignmentChanged` above by design.
describe("hasVatRecodeChanged (Phase 29)", () => {
  it("true for a first-time Find & Recode VAT recode", () => {
    const previous = txn({ suggestedVatCode: "STD", allocationMethod: "Future AI", isManualOverride: false });
    expect(hasVatRecodeChanged(previous, "STD")).toBe(true);
  });

  it("false for a genuine no-op re-recode", () => {
    const previous = txn({ suggestedVatCode: "STD", allocationMethod: "Manual", isManualOverride: true });
    expect(hasVatRecodeChanged(previous, "STD")).toBe(false);
  });
});

describe("hasMerchantAssignmentChanged (Phase 29)", () => {
  it("true when the merchant id differs", () => {
    expect(hasMerchantAssignmentChanged(txn({ matchedMerchantId: null }), 12)).toBe(true);
  });

  it("false when re-saving the identical merchant id", () => {
    expect(hasMerchantAssignmentChanged(txn({ matchedMerchantId: 12 }), 12)).toBe(false);
  });
});

// Phase 29A — the forensic review's own explicit requirement: prove the
// END-TO-END state transition for every allocation write path, composing
// the REAL `needsAiAcceptAction`/`computeMatchStatus` functions over a
// fixture that mirrors exactly the literal field values each real write
// path (`bulkAssignGl`, `applyRuleActions`) is confirmed (by direct
// source reading, cross-referenced in each test's own comment) to write.
// This codebase has no precedent for mocking the Supabase client itself
// (see the module docstring above / the Phase 29 report's own "remaining
// limitations"), so this is the most direct proof achievable without
// introducing a new, unprecedented mocking layer for one test file.
describe("Phase 29A — end-to-end allocation write-path state transitions", () => {
  it("AI Accept: Future AI + Suggested → (bulkAssignGl's real fields) → Manual + Allocated + G + is_manual_override=true → needsAiAcceptAction=false", () => {
    const beforeAccept = txn({
      suggestedGlAccount: "6100",
      allocationStatus: "Suggested",
      allocationMethod: "Future AI",
      allocationType: "G",
      isManualOverride: false,
    });
    expect(needsAiAcceptAction(beforeAccept)).toBe(true);

    // The exact literal update object `bulkAssignGl` writes (transaction-explorer-repository.ts):
    // { suggested_gl_account: glAccount, allocation_type: "G", allocation_status: "Allocated", allocation_method: "Manual", is_manual_override: true }
    const afterAccept: BankTransactionRecord = {
      ...beforeAccept,
      suggestedGlAccount: "6100",
      allocationType: "G",
      allocationStatus: "Allocated",
      allocationMethod: "Manual",
      isManualOverride: true,
    };

    expect(needsAiAcceptAction(afterAccept)).toBe(false);
    expect(computeMatchStatus(afterAccept, false, false)).toEqual({ label: "Allocated", tone: "good" });
  });

  it("Manual allocation of a genuinely Unallocated transaction: Save → Manual + Allocated + G + is_manual_override=true → needsAiAcceptAction=false", () => {
    const beforeSave = txn({ suggestedGlAccount: null, allocationStatus: "Unallocated", allocationMethod: null, allocationType: null, isManualOverride: false });
    expect(needsAiAcceptAction(beforeSave)).toBe(false); // never showed Accept in the first place — no AI involvement

    const afterSave: BankTransactionRecord = { ...beforeSave, suggestedGlAccount: "6940", allocationType: "G", allocationStatus: "Allocated", allocationMethod: "Manual", isManualOverride: true };

    expect(needsAiAcceptAction(afterSave)).toBe(false);
    expect(computeMatchStatus(afterSave, false, false)).toEqual({ label: "Allocated", tone: "good" });
  });

  it("Duplicate Accept prevention: a second Accept on an already-accepted row is a genuine no-op (hasGlAssignmentChanged returns false, no duplicate history)", () => {
    const alreadyAccepted = txn({ suggestedGlAccount: "6100", allocationStatus: "Allocated", allocationMethod: "Manual", allocationType: "G", isManualOverride: true });
    // A second Accept click commits the exact same value — the no-op guard must recognise nothing changed.
    expect(hasGlAssignmentChanged(alreadyAccepted, "6100")).toBe(false);
    // And the button is correctly gone, so a second click can't even happen in the UI.
    expect(needsAiAcceptAction(alreadyAccepted)).toBe(false);
  });

  it("Banking Rule allocation: rule_id set, allocation_method untouched (the established vocabulary — Rule identity lives in rule_id, not allocation_method), is_manual_override stays false, Accept never shows, Rule Created badge shows", () => {
    // The exact literal fields `applyRuleActions` writes for a GL-resolving
    // rule (transaction-explorer-repository.ts): suggested_gl_account,
    // allocation_type: "G", allocation_status, rule_id — it NEVER sets
    // allocation_method or is_manual_override at all (left at their
    // existing values — false/null for a fresh Unallocated transaction).
    const afterRuleMatch: BankTransactionRecord = txn({
      suggestedGlAccount: "6100",
      allocationType: "G",
      allocationStatus: "Allocated",
      allocationMethod: null,
      isManualOverride: false,
      ruleId: 42,
    });

    expect(needsAiAcceptAction(afterRuleMatch)).toBe(false); // allocationMethod is not "Future AI"
    expect(computeMatchStatus(afterRuleMatch, false, false)).toEqual({ label: "Rule Created", tone: "info" }); // rule_id wins precedence
  });

  it("Automatic high-confidence AI allocation (fn_apply_ai_classification) remains Future AI + Allocated + G + is_manual_override=false, distinguishable from human acceptance", () => {
    // The exact literal fields fn_apply_ai_classification (migration 0087)
    // writes: suggested_gl_account, allocation_status = 'Allocated',
    // allocation_method = 'Future AI', allocation_type = 'G',
    // is_manual_override = false. Unchanged by this phase — verified by
    // direct reading of the migration SQL, not modified.
    const autoAllocated = txn({ suggestedGlAccount: "6940", allocationStatus: "Allocated", allocationMethod: "Future AI", allocationType: "G", isManualOverride: false });

    expect(needsAiAcceptAction(autoAllocated)).toBe(true); // still needs human confirmation
    expect(computeMatchStatus(autoAllocated, false, false)).toEqual({ label: "AI Allocated", tone: "warn" }); // never the settled green
  });
});

// Phase 31 — "Save Selected"/bulk-save requirement: a posted transaction
// must come back as a reportable failure, not a silent no-op success.
// `allocateRow`'s final `.update(...).is("journal_id", null).select("id")`
// already correctly EXCLUDES a posted row from what it updates (the
// guard itself is unchanged) — what was missing is telling the caller
// which requested ids the guard actually blocked. `computeBlockedIds` is
// that computation, extracted pure so it's provable without a Supabase
// mock — same reasoning as `hasGlAssignmentChanged` etc. above.
describe("computeBlockedIds (Phase 31)", () => {
  it("nothing blocked when every requested id comes back updated", () => {
    expect(computeBlockedIds([1, 2, 3], [{ id: 1 }, { id: 2 }, { id: 3 }])).toEqual([]);
  });

  it("a single posted transaction — the id the guard excluded is reported blocked", () => {
    expect(computeBlockedIds([501], [])).toEqual([501]);
  });

  it("partial block — most of a multi-id 'apply to similar' request succeeds, one posted id is reported blocked, not the whole batch", () => {
    expect(computeBlockedIds([1, 2, 3], [{ id: 1 }, { id: 3 }])).toEqual([2]);
  });

  it("every requested id blocked", () => {
    expect(computeBlockedIds([10, 20], [])).toEqual([10, 20]);
  });

  it("order of the updated rows never matters, only membership", () => {
    expect(computeBlockedIds([1, 2, 3], [{ id: 3 }, { id: 1 }, { id: 2 }])).toEqual([]);
  });
});

// Phase 31A — the transaction Description/Narration becomes editable
// (`ae_bank_transactions.description`, already a plain writable column —
// no migration was needed). These two functions are the repository's
// entire real contribution to that: deciding whether to include it in
// the UPDATE at all, and recognising the one real consequence of it
// being editable — `description` is part of `ae_bank_transactions_natural_key`
// (migration 0004), so an edit can, rarely, collide with another
// transaction sharing the same account/date/reference/amounts.
describe("buildAllocateRowFinalUpdate (Phase 31A)", () => {
  it("omits description entirely when unchanged (null) — item 12: never an unnecessary write", () => {
    const update = buildAllocateRowFinalUpdate({ type: "G", allocationNotes: "", description: null });
    expect(update).toEqual({ allocation_type: "G", allocation_notes: "" });
    expect("description" in update).toBe(false);
  });

  it("includes description when a real value is provided", () => {
    const update = buildAllocateRowFinalUpdate({ type: "G", allocationNotes: "", description: "Ren Remuneration" });
    expect(update).toEqual({ allocation_type: "G", allocation_notes: "", description: "Ren Remuneration" });
  });

  it("still allows clearing the description to an empty string — distinct from omitting it", () => {
    const update = buildAllocateRowFinalUpdate({ type: "G", allocationNotes: "", description: "" });
    expect(update).toEqual({ allocation_type: "G", allocation_notes: "", description: "" });
  });

  it("allocation_type/allocation_notes are always present regardless of description", () => {
    const update = buildAllocateRowFinalUpdate({ type: "S", allocationNotes: "Reviewed", description: null });
    expect(update).toEqual({ allocation_type: "S", allocation_notes: "Reviewed" });
  });
});

describe("isDuplicateNaturalKey (Phase 31A)", () => {
  it("true for a genuine 23505 on the natural-key constraint", () => {
    expect(isDuplicateNaturalKey({ code: "23505", message: 'duplicate key value violates unique constraint "ae_bank_transactions_natural_key"' })).toBe(true);
  });

  it("false for a 23505 on a different constraint — never over-matches", () => {
    expect(isDuplicateNaturalKey({ code: "23505", message: 'duplicate key value violates unique constraint "some_other_constraint"' })).toBe(false);
  });

  it("false for an unrelated error code", () => {
    expect(isDuplicateNaturalKey({ code: "23503", message: "foreign key violation" })).toBe(false);
  });

  it("false for null/non-object input — never throws on a malformed error", () => {
    expect(isDuplicateNaturalKey(null)).toBe(false);
    expect(isDuplicateNaturalKey("a string error")).toBe(false);
    expect(isDuplicateNaturalKey(undefined)).toBe(false);
  });
});
