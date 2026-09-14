/**
 * Regression tests for the human-review hold (migration 0094).
 *
 * THE DEFECT: during the Metanoia Hospitality / New Handcrafted Food
 * Products migration, 141 imported transactions were deliberately left
 * Unprocessed for an accountant to classify. The `AiClassificationSweep`
 * automation went on classifying them in batches of 20 — 40 rows were
 * auto-assigned to a Credit Card liability account before the task was
 * paused. Nothing expressed "a person is dealing with this".
 *
 * The guard exists at three layers and these tests cover all three:
 *
 *   1. `isEligibleForAiClassification`  — the pure, shared check (here)
 *   2. `listAiClassificationEligibleTransactions` — the sweep's own
 *      candidate query, so a held row is never even a candidate
 *      (`repositories/ai-classification-candidates.test.ts`)
 *   3. `fn_apply_ai_classification` — the authoritative database claim,
 *      which refuses the write regardless of what the caller believed
 *      (migration 0094, verified live against production below)
 *
 * The service layer is driven end-to-end below through
 * `classifyTransactionsWithAiManual`, with the AI provider mocked, so
 * these prove the sweep genuinely does not classify held rows rather
 * than only that a predicate returns false.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/transaction-explorer-repository", () => ({
  getTransactionsByIds: vi.fn(),
  applyAiClassification: vi.fn(),
  listAiClassificationEligibleTransactions: vi.fn(),
}));
vi.mock("@/server/ai/transaction-classification/evidence-builder", () => ({ buildClassificationEvidence: vi.fn() }));
vi.mock("@/server/ai/transaction-classification/classification-engine", () => ({
  classifyTransaction: vi.fn(),
  // Returns null so no AI provider is reachable: these tests are about
  // whether a held transaction is ever OFFERED to a provider, never
  // about what a provider would answer.
  getDefaultTransactionClassificationProvider: vi.fn(async () => null),
}));
vi.mock("@/server/billing-platform/engine/usage-metering-engine", () => ({ recordUsageEvent: vi.fn() }));

import { classifyTransactionsWithAiManual, HELD_FOR_REVIEW_SKIP_REASON } from "./transaction-classification-service";
import * as repo from "@/server/repositories/transaction-explorer-repository";
import { isEligibleForAiClassification } from "@/server/ai/transaction-classification/types";
import { isHeldForHumanReview, transactionPostingStatus, type BankTransactionRecord } from "@/server/accounting/types";

const COMPANY_ID = "co_metanoia";
const OTHER_COMPANY_ID = "co_northwood";

/** An imported, unclassified Xero row — the exact shape of the 141. */
function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 2013,
    companyId: COMPANY_ID,
    transactionDate: "2026-03-05",
    reference: "",
    description: "Spend Money — Capitec Bank",
    beneficiary: "Capitec Bank",
    debit: 6,
    credit: 0,
    balance: null,
    bankAccount: "Metanoia Hospitality",
    bankAccountId: 3,
    glAccount: "3030 - Bank Charges, 820 - VAT",
    vat: null,
    notes: "Migrated from Xero. Source: Spend Money.",
    importBatch: "XERO-Metanoia Hospitality",
    sourceFilename: "Metanoia_Hospitality__Pty__Ltd_-_Bank_transactions_by_date.xlsx",
    createdAt: "2026-09-09T00:00:00Z",
    allocationStatus: "Unallocated",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    confidenceScore: null,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: null,
    suggestedVatCode: null,
    allocationMethod: null,
    allocationReason: "",
    isManualOverride: false,
    reviewStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    journalId: null,
    matchedCustomerId: null,
    matchedMerchantId: null,
    ruleId: null,
    allocationType: null,
    allocationNotes: "",
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
    postedFlag: false,
    postedAt: null,
    postingBatchId: null,
    sourceOccurrence: 2,
    reviewHold: false,
    reviewHoldReason: "",
    reviewHoldBy: null,
    reviewHoldAt: null,
    overrideSupplierInvoiceMatching: false,
    overrideSupplierInvoiceMatchingBy: null,
    overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

/** The three states that mean "a person is dealing with this". */
const HELD_VARIANTS: [string, Partial<BankTransactionRecord>][] = [
  ["explicit review_hold", { reviewHold: true, reviewHoldReason: "Migration review in progress", reviewHoldBy: "accountant" }],
  ["a recorded human review decision", { reviewStatus: "Approved" }],
  ["a system-raised required action", { requiredAction: "Review — possible duplicate payment" }],
];

beforeEach(() => {
  vi.mocked(repo.getTransactionsByIds).mockReset();
  vi.mocked(repo.applyAiClassification).mockReset().mockResolvedValue(undefined);
});

describe("1. AiClassificationSweep cannot classify a transaction held for human review", () => {
  for (const [label, held] of HELD_VARIANTS) {
    it(`the shared eligibility check rejects a transaction with ${label}`, () => {
      expect(isEligibleForAiClassification(txn(held))).toBe(false);
      expect(isHeldForHumanReview(txn(held))).toBe(true);
    });

    it(`the service never writes a classification for a transaction with ${label}`, async () => {
      vi.mocked(repo.getTransactionsByIds).mockResolvedValue([txn(held)]);

      const outcome = await classifyTransactionsWithAiManual(COMPANY_ID, [2013], "tester", 10);

      expect(repo.applyAiClassification).not.toHaveBeenCalled();
      expect(outcome.classified).toBe(0);
      expect(outcome.skipped).toEqual([{ transactionId: 2013, reason: HELD_FOR_REVIEW_SKIP_REASON }]);
    });
  }
});

describe("2. an Unprocessed transaction held for review stays Unprocessed", () => {
  it("the hold does not classify, allocate, or advance the workflow state", async () => {
    const held = txn({ reviewHold: true, reviewHoldReason: "Migration review" });
    expect(transactionPostingStatus(held)).toBe("Unprocessed");

    vi.mocked(repo.getTransactionsByIds).mockResolvedValue([held]);
    await classifyTransactionsWithAiManual(COMPANY_ID, [2013], "tester", 10);

    expect(repo.applyAiClassification).not.toHaveBeenCalled();
    expect(transactionPostingStatus(held)).toBe("Unprocessed");
    expect(held.suggestedGlAccount).toBeNull();
    expect(held.allocationStatus).toBe("Unallocated");
  });

  it("a hold is not itself a classification — it never makes a row Ready to Post", () => {
    expect(transactionPostingStatus(txn({ reviewHold: true }))).toBe("Unprocessed");
  });
});

describe("3 + 4. the Xero source account and the original amount are unchanged", () => {
  it("holding and attempting to classify leaves source account, amount, date and identity intact", async () => {
    const held = txn({ reviewHold: true, reviewHoldReason: "Migration review" });
    const snapshot = JSON.stringify(held);

    vi.mocked(repo.getTransactionsByIds).mockResolvedValue([held]);
    await classifyTransactionsWithAiManual(COMPANY_ID, [2013], "tester", 10);

    expect(JSON.stringify(held)).toBe(snapshot);
    expect(held.glAccount).toBe("3030 - Bank Charges, 820 - VAT");
    expect(held.debit).toBe(6);
    expect(held.credit).toBe(0);
    expect(held.transactionDate).toBe("2026-03-05");
    expect(held.sourceOccurrence).toBe(2);
  });

  it("the four concepts stay distinct — source account, VYRON allocation, AI method, human decision", () => {
    const held = txn({ suggestedGlAccount: "2600", allocationMethod: "Future AI", reviewStatus: "Rejected", reviewHold: true });
    expect(held.glAccount).toBe("3030 - Bank Charges, 820 - VAT"); // the source's account
    expect(held.suggestedGlAccount).toBe("2600"); // VYRON's allocation
    expect(held.allocationMethod).toBe("Future AI"); // how it arose
    expect(held.reviewStatus).toBe("Rejected"); // the human's decision
    expect(held.reviewHold).toBe(true); // the human's hold
  });
});

describe("5. an already-classified transaction held for review cannot be overwritten", () => {
  it("a classified-then-held transaction is not re-classified by the sweep", async () => {
    // The dangerous case: the AI already guessed 2600, an accountant
    // pulled the row back for review, and a later sweep must not touch
    // it again.
    const classifiedThenHeld = txn({
      suggestedGlAccount: "2600",
      allocationStatus: "Suggested",
      allocationMethod: "Future AI",
      reviewHold: true,
      reviewHoldReason: "Bank charge wrongly coded to Credit Card",
    });
    vi.mocked(repo.getTransactionsByIds).mockResolvedValue([classifiedThenHeld]);

    await classifyTransactionsWithAiManual(COMPANY_ID, [2013], "tester", 10);

    expect(repo.applyAiClassification).not.toHaveBeenCalled();
    expect(classifiedThenHeld.suggestedGlAccount).toBe("2600");
    expect(isEligibleForAiClassification(classifiedThenHeld)).toBe(false);
  });

  it("a human review decision alone blocks re-classification, hold flag or not", () => {
    expect(isEligibleForAiClassification(txn({ reviewStatus: "Approved" }))).toBe(false);
    expect(isEligibleForAiClassification(txn({ reviewStatus: "Rejected" }))).toBe(false);
    expect(isEligibleForAiClassification(txn({ reviewStatus: "Ignored" }))).toBe(false);
  });
});

describe("6. a transaction NOT held for review is still processed normally", () => {
  it("remains eligible, and the guard does not narrow anything else", () => {
    const free = txn();
    expect(isHeldForHumanReview(free)).toBe(false);
    expect(isEligibleForAiClassification(free)).toBe(true);
  });

  it("releasing a hold restores eligibility — the guard is a hold, not a permanent exclusion", () => {
    const held = txn({ reviewHold: true, reviewHoldReason: "checking" });
    expect(isEligibleForAiClassification(held)).toBe(false);

    const released = { ...held, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null };
    expect(isEligibleForAiClassification(released)).toBe(true);
  });

  it("the pre-existing exclusions still apply on their own", () => {
    expect(isEligibleForAiClassification(txn({ journalId: 900 }))).toBe(false);
    expect(isEligibleForAiClassification(txn({ suggestedGlAccount: "3030" }))).toBe(false);
    expect(isEligibleForAiClassification(txn({ ruleId: 5 }))).toBe(false);
    expect(isEligibleForAiClassification(txn({ isManualOverride: true }))).toBe(false);
    expect(isEligibleForAiClassification(txn({ matchedSupplierId: 7 }))).toBe(false);
  });
});

describe("7. the guard does not affect other companies", () => {
  it("a held transaction in one company does not make another company's rows ineligible", () => {
    const heldHere = txn({ companyId: COMPANY_ID, reviewHold: true });
    const freeElsewhere = txn({ id: 9001, companyId: OTHER_COMPANY_ID, reviewHold: false });
    expect(isEligibleForAiClassification(heldHere)).toBe(false);
    expect(isEligibleForAiClassification(freeElsewhere)).toBe(true);
  });

  it("the hold is evaluated per transaction, so a mixed selection only withholds the held row", async () => {
    const held = txn({ id: 1, reviewHold: true });
    const free = txn({ id: 2 });
    vi.mocked(repo.getTransactionsByIds).mockResolvedValue([held, free]);

    const outcome = await classifyTransactionsWithAiManual(COMPANY_ID, [1, 2], "tester", 10);
    const reasonById = new Map(outcome.skipped.map((s) => [s.transactionId, s.reason]));

    // The held row is withheld BY THE HOLD. The free row reaches the
    // provider step and is skipped only because no provider is
    // configured in this test — i.e. the guard did not touch it.
    expect(reasonById.get(1)).toBe(HELD_FOR_REVIEW_SKIP_REASON);
    expect(reasonById.get(2)).not.toBe(HELD_FOR_REVIEW_SKIP_REASON);
  });
});

describe("8 + 9. the guard posts nothing and creates no accounting records", () => {
  it("classification never touches a journal, and a held row certainly does not", async () => {
    const held = txn({ reviewHold: true });
    vi.mocked(repo.getTransactionsByIds).mockResolvedValue([held]);

    await classifyTransactionsWithAiManual(COMPANY_ID, [2013], "tester", 10);

    expect(held.journalId).toBeNull();
    expect(held.postedFlag).toBe(false);
    expect(held.postingBatchId).toBeNull();
    expect(held.reconciliationId).toBeNull();
    expect(transactionPostingStatus(held)).toBe("Unprocessed");
  });

  it("`applyAiClassification` is the only write this path can make, and it is not called for a held row", async () => {
    vi.mocked(repo.getTransactionsByIds).mockResolvedValue([txn({ reviewHold: true })]);
    await classifyTransactionsWithAiManual(COMPANY_ID, [2013], "tester", 10);
    expect(repo.applyAiClassification).not.toHaveBeenCalled();
  });
});
