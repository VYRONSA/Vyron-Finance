/**
 * Supplier Invoice Matching Override (migration 0095) and the bank
 * account GL resolution the posting preflight depends on.
 *
 * The override lifts exactly one requirement — "this supplier payment
 * must settle an invoice VYRON can point at" — and nothing else. These
 * tests hold it to that: it never invents an invoice, never touches the
 * Xero source data, and never posts.
 */
import { describe, expect, it } from "vitest";

import { buildBankPostingPlan, type PostingPlanContext } from "./bank-posting-service";
import { bankAccountGlMissingReason, buildJournalLinesForTransaction } from "./journal-service";
import {
  isSubjectToSupplierInvoiceMatching,
  satisfiesSupplierInvoiceMatching,
  SUPPLIER_INVOICE_MATCHING_REQUIRED_REASON,
  type BankTransactionRecord,
} from "@/server/accounting/types";
import type { FinancialYear } from "@/server/company-management/types";

const COMPANY_ID = "co_1";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1, companyId: COMPANY_ID, transactionDate: "2026-03-15", reference: "", description: "Payable Payment — Three Streams",
    beneficiary: "Three Streams", debit: 1000, credit: 0, balance: null, bankAccount: "Metanoia Hospitality", bankAccountId: 3,
    glAccount: "800 - Accounts Payable", vat: null, notes: "", importBatch: "XERO", sourceFilename: "bank.xlsx",
    createdAt: "2026-09-09T00:00:00Z", allocationStatus: "Allocated", matchedSupplierId: 42, matchedSupplierName: "Three Streams",
    matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: "800", suggestedVatCode: null, allocationMethod: "Manual", allocationReason: "", isManualOverride: true,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null,
    matchedMerchantId: null, ruleId: null, allocationType: "S", allocationNotes: "", entrySource: "Imported",
    captureStatus: null, cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false,
    postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "",
    reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false,
    overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

const BANK_GL = { glAccount: "1020", accountNumber: "METANOIA-HOSPITALITY" };
const OPEN_YEAR: FinancialYear[] = [{
  id: 1, companyId: COMPANY_ID, yearLabel: "FY2027", startDate: "2026-03-01", endDate: "2027-02-28",
  status: "Open", isCurrent: true, createdAt: "2026-03-01T00:00:00Z", lockDate: null, reopenedAt: null, reopenedBy: null,
}];

function context(overrides: Partial<PostingPlanContext> = {}): PostingPlanContext {
  return {
    bankAccountsById: new Map([[3, BANK_GL]]),
    // The seeded "Supplier Payment" / "Customer Receipt" control accounts.
    controlAccounts: { creditors: "2000", debtors: "1100" },
    splitsByTransactionId: new Map(),
    accountCodes: new Set(["1020", "800", "3030"]),
    financialYears: OPEN_YEAR,
    financialYearStartMonth: 3,
    journalNumberAt: (i) => `JR${String(1 + i).padStart(6, "0")}`,
    ...overrides,
  };
}

describe("who the requirement applies to", () => {
  it("applies to a supplier payment", () => {
    expect(isSubjectToSupplierInvoiceMatching(txn())).toBe(true);
  });

  it("does not apply to a customer receipt — there is no supplier invoice to match", () => {
    expect(isSubjectToSupplierInvoiceMatching(txn({ debit: 0, credit: 500, allocationType: "C", matchedSupplierId: null }))).toBe(false);
  });

  it("does not apply to a payment allocated straight to a GL account", () => {
    expect(isSubjectToSupplierInvoiceMatching(txn({ allocationType: "G", matchedSupplierId: null }))).toBe(false);
  });
});

describe("1–3. the three-way posting eligibility", () => {
  it("supplier payment linked to an invoice → can post", () => {
    const t = txn({ matchedBillId: 77 });
    expect(satisfiesSupplierInvoiceMatching(t)).toBe(true);
    const plan = buildBankPostingPlan([t], context());
    expect(plan.journals).toHaveLength(1);
    expect(plan.blocked).toEqual([]);
  });

  it("supplier payment, no invoice, override OFF → cannot post, with the exact required message", () => {
    const t = txn({ matchedBillId: null, overrideSupplierInvoiceMatching: false });
    expect(satisfiesSupplierInvoiceMatching(t)).toBe(false);
    const plan = buildBankPostingPlan([t], context());
    expect(plan.journals).toEqual([]);
    expect(plan.blocked).toEqual([{ transactionId: 1, reason: SUPPLIER_INVOICE_MATCHING_REQUIRED_REASON, kind: "blocked" }]);
    // Never silently skipped — the reason names both ways out.
    expect(plan.blocked[0].reason).toContain("link a supplier invoice");
    expect(plan.blocked[0].reason).toContain("Override Supplier Invoice Matching");
  });

  it("supplier payment, no invoice, override ON → passes invoice-match validation and posts", () => {
    const t = txn({ matchedBillId: null, overrideSupplierInvoiceMatching: true });
    expect(satisfiesSupplierInvoiceMatching(t)).toBe(true);
    const plan = buildBankPostingPlan([t], context());
    expect(plan.journals).toHaveLength(1);
    expect(plan.blocked).toEqual([]);
  });

  it("the override lifts ONLY invoice matching — every other posting rule still applies", () => {
    // Overridden, but the bank account has no GL account: still blocked.
    const t = txn({ matchedBillId: null, overrideSupplierInvoiceMatching: true });
    const plan = buildBankPostingPlan([t], context({ bankAccountsById: new Map([[3, { glAccount: "", accountNumber: "X" }]]) }));
    expect(plan.journals).toEqual([]);
    expect(plan.blocked[0].reason).toContain("has no GL account configured");
  });

  it("the override does not rescue an unclassified transaction", () => {
    const t = txn({ matchedBillId: null, overrideSupplierInvoiceMatching: true, suggestedGlAccount: null, allocationType: null, matchedSupplierId: null, isSplit: false });
    const plan = buildBankPostingPlan([t], context());
    expect(plan.journals).toEqual([]);
    expect(plan.notReady).toHaveLength(1);
  });
});

describe("6–7. the override changes nothing else", () => {
  it("does not create a supplier invoice or a match", () => {
    const before = txn({ matchedBillId: null });
    const after = { ...before, overrideSupplierInvoiceMatching: true };
    expect(after.matchedBillId).toBeNull();
    expect(after.matchedSupplierId).toBe(before.matchedSupplierId);
  });

  it("does not alter any Xero source field, amount, date, reference or duplicate identity", () => {
    const before = txn();
    const after = { ...before, overrideSupplierInvoiceMatching: true };
    expect(after.glAccount).toBe(before.glAccount);
    expect(after.debit).toBe(before.debit);
    expect(after.credit).toBe(before.credit);
    expect(after.transactionDate).toBe(before.transactionDate);
    expect(after.reference).toBe(before.reference);
    expect(after.sourceOccurrence).toBe(before.sourceOccurrence);
    expect(after.description).toBe(before.description);
  });

  it("does not classify the payment to any account", () => {
    const before = txn({ suggestedGlAccount: null, allocationType: null });
    const after = { ...before, overrideSupplierInvoiceMatching: true };
    expect(after.suggestedGlAccount).toBeNull();
    expect(after.allocationType).toBeNull();
  });

  it("posts the same double entry it would have posted with a linked invoice", () => {
    const overridden = txn({ matchedBillId: null, overrideSupplierInvoiceMatching: true });
    const matched = txn({ matchedBillId: 77 });
    const a = buildJournalLinesForTransaction(overridden, BANK_GL);
    const b = buildJournalLinesForTransaction(matched, BANK_GL);
    expect(a).toEqual(b);
  });
});

describe("8–9. posted and review-held transactions", () => {
  it("a posted transaction is excluded before the override is even considered", () => {
    const t = txn({ postedFlag: true, journalId: 900, matchedBillId: null, overrideSupplierInvoiceMatching: false });
    const plan = buildBankPostingPlan([t], context());
    expect(plan.journals).toEqual([]);
    expect(plan.alreadyPosted).toHaveLength(1);
    expect(plan.blocked).toEqual([]);
  });

  it("an override can never post a transaction that is already posted", () => {
    const t = txn({ postedFlag: true, journalId: 900, overrideSupplierInvoiceMatching: true });
    expect(buildBankPostingPlan([t], context()).journals).toEqual([]);
  });

  it("a review hold is unaffected by the override — the 0094 guard is about automatic classification, not posting eligibility", () => {
    const held = txn({ reviewHold: true, matchedBillId: 77 });
    // Holding does not, by itself, block a deliberate human posting; what
    // it blocks is automatic classification (tested in
    // `ai-classification-review-hold.test.ts`). The override does not
    // touch that guard in either direction.
    expect(held.reviewHold).toBe(true);
    expect(satisfiesSupplierInvoiceMatching(held)).toBe(true);
  });
});

describe("10–12. bank account GL resolution (the reported preflight error)", () => {
  it("a correctly configured bank account posts without any GL configuration error", () => {
    const plan = buildBankPostingPlan([txn({ matchedBillId: 77 })], context());
    expect(plan.journals).toHaveLength(1);
    expect(plan.blocked).toEqual([]);
    expect(JSON.stringify(plan)).not.toMatch(/no GL account configured/);
  });

  it("a genuinely unconfigured bank account names the actual account, not a generic message", () => {
    const t = txn({ matchedBillId: 77, bankAccount: "62050837304" });
    const plan = buildBankPostingPlan([t], context({ bankAccountsById: new Map([[3, { glAccount: "", accountNumber: "62050837304" }]]) }));
    expect(plan.blocked[0].reason).toContain('Bank account "62050837304"');
    expect(plan.blocked[0].reason).toContain("Configure it under Bank Accounts");
  });

  it("the message distinguishes the BANK's GL account from the one allocated to the transaction", () => {
    // The reported confusion: a transaction allocated to 2600 with the
    // error claiming no GL account is configured.
    const reason = bankAccountGlMissingReason("62050837304");
    expect(reason).toContain("separate from the GL account allocated to the transaction");
  });

  it("falls back to a sensible phrase when the transaction carries no bank account name", () => {
    expect(bankAccountGlMissingReason("")).toContain("This transaction's bank account");
  });

  it("an unresolved bank account id is reported, not silently posted", () => {
    const plan = buildBankPostingPlan([txn({ matchedBillId: 77 })], context({ bankAccountsById: new Map() }));
    expect(plan.journals).toEqual([]);
    expect(plan.blocked).toHaveLength(1);
  });
});

describe("13–14. update never posts; posting happens only after every check", () => {
  it("building a plan is read-only — it creates no journal, GL entry or posting batch", () => {
    const t = txn({ matchedBillId: 77 });
    const snapshot = JSON.stringify(t);
    const plan = buildBankPostingPlan([t], context());
    expect(JSON.stringify(t)).toBe(snapshot);
    expect(t.journalId).toBeNull();
    expect(t.postedFlag).toBe(false);
    expect(t.postingBatchId).toBeNull();
    // A plan is an intention: journals exist only once the atomic RPC runs.
    expect(plan.journals[0]).toMatchObject({ journalNumber: "JR000001" });
  });

  it("a batch posts only the transactions that passed every check, and reports the rest", () => {
    const ok = txn({ id: 1, matchedBillId: 77 });
    const needsInvoice = txn({ id: 2, matchedBillId: null, overrideSupplierInvoiceMatching: false });
    const overridden = txn({ id: 3, matchedBillId: null, overrideSupplierInvoiceMatching: true });

    const plan = buildBankPostingPlan([ok, needsInvoice, overridden], context());

    expect(plan.journals.flatMap((j) => j.transactionIds).sort()).toEqual([1, 3]);
    expect(plan.blocked.map((b) => b.transactionId)).toEqual([2]);
    expect(plan.blocked[0].reason).toBe(SUPPLIER_INVOICE_MATCHING_REQUIRED_REASON);
  });
});
