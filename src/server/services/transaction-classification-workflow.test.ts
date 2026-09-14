/**
 * The CLASSIFY stage of the banking workflow, and the boundary between it
 * and POST:
 *
 *   IMPORT -> (Unprocessed) -> CLASSIFY -> (Ready to Post) -> POST -> (Posted)
 *
 * Modelled on the real Metanoia Hospitality / New Handcrafted Food
 * Products migration, where 141 transactions arrived from Xero carrying
 * the export's own "Related Account" text but no VYRON allocation. Those
 * rows are the reason this file exists: an imported transaction is
 * Unprocessed until an accountant classifies it, classifying it makes it
 * Ready to Post and nothing more, and posting is always a separate,
 * explicit act.
 *
 * The split case here is the real one too — a R6.00 bank charge whose
 * Xero related account is "3030 - Bank Charges, 820 - VAT", i.e. two
 * accounts in one transaction. Collapsing that into a single GL account
 * would misstate both the expense and the VAT, so it is allocated as a
 * genuine split.
 */
import { describe, expect, it } from "vitest";

import { buildBankPostingPlan, type PostingPlanContext } from "./bank-posting-service";
import { buildJournalLinesForSplitTransaction, buildJournalLinesForTransaction } from "./journal-service";
import { validateSplitLines } from "@/server/matching/split-transaction-engine";
import { transactionPostingStatus, type BankTransactionRecord } from "@/server/accounting/types";
import type { FinancialYear } from "@/server/company-management/types";

const COMPANY_ID = "co_metanoia";

/** An imported-but-unclassified row, exactly as the Xero bank import
 * writes it: the source's own account text in `glAccount`, and NO
 * `suggestedGlAccount`, because the import never invents an allocation. */
function importedTransaction(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
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
    // The Xero export's "Related Account" — preserved verbatim, never
    // overwritten by classification.
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

const BANK_GL = { glAccount: "1020", accountNumber: "METANOIA-HOSPITALITY" };

const OPEN_YEAR: FinancialYear[] = [
  {
    id: 1, companyId: COMPANY_ID, yearLabel: "FY2027", startDate: "2026-03-01", endDate: "2027-02-28",
    status: "Open", isCurrent: true, createdAt: "2026-03-01T00:00:00Z", lockDate: null, reopenedAt: null, reopenedBy: null,
  },
];

function context(overrides: Partial<PostingPlanContext> = {}): PostingPlanContext {
  return {
    bankAccountsById: new Map([[3, BANK_GL]]),
    // The seeded "Supplier Payment" / "Customer Receipt" control accounts.
    controlAccounts: { creditors: "2000", debtors: "1100" },
    splitsByTransactionId: new Map(),
    accountCodes: new Set(["1020", "3030", "2300", "3420", "800", "2100"]),
    financialYears: OPEN_YEAR,
    financialYearStartMonth: 3,
    journalNumberAt: (i) => `JR${String(1 + i).padStart(6, "0")}`,
    ...overrides,
  };
}

describe("unprocessed imported transactions", () => {
  it("an imported transaction with no allocation is Unprocessed, not Ready to Post", () => {
    expect(transactionPostingStatus(importedTransaction())).toBe("Unprocessed");
  });

  it("carrying the source's account text does NOT make a transaction classified", () => {
    // The whole point: "3030 - Bank Charges, 820 - VAT" is evidence, not
    // an allocation. Treating it as one would be VYRON classifying the
    // client's books for them.
    const txn = importedTransaction({ glAccount: "3030 - Bank Charges, 820 - VAT", suggestedGlAccount: null });
    expect(txn.glAccount).not.toBe("");
    expect(transactionPostingStatus(txn)).toBe("Unprocessed");
  });

  it("an unprocessed transaction is refused by the posting engine, with a reason naming the fix", () => {
    const plan = buildBankPostingPlan([importedTransaction()], context());
    expect(plan.journals).toEqual([]);
    expect(plan.notReady).toEqual([
      { transactionId: 2013, reason: "Not classified yet — assign a GL account (or split it) before posting.", kind: "not-ready" },
    ]);
  });

  it("the source account survives classification — it is evidence, not a working field", () => {
    const before = importedTransaction();
    const classified = { ...before, suggestedGlAccount: "3030", allocationStatus: "Allocated" as const, allocationMethod: "Manual" as const };
    expect(classified.glAccount).toBe(before.glAccount);
  });
});

describe("classification", () => {
  it("assigning a GL account moves a transaction Unprocessed -> Ready to Post", () => {
    const before = importedTransaction();
    expect(transactionPostingStatus(before)).toBe("Unprocessed");

    const after = { ...before, suggestedGlAccount: "3030", allocationType: "G" as const, allocationMethod: "Manual" as const, allocationStatus: "Allocated" as const };
    expect(transactionPostingStatus(after)).toBe("Ready to Post");
  });

  it("a classified transaction is Ready to Post — NOT Posted", () => {
    const classified = importedTransaction({ suggestedGlAccount: "3030", allocationStatus: "Allocated" });
    expect(transactionPostingStatus(classified)).toBe("Ready to Post");
    expect(classified.postedFlag).toBe(false);
    expect(classified.journalId).toBeNull();
  });

  it("clearing an allocation moves it back to Unprocessed", () => {
    const classified = importedTransaction({ suggestedGlAccount: "3030" });
    expect(transactionPostingStatus(classified)).toBe("Ready to Post");
    // The Explorer writes an empty string when an accountant clears the
    // account, not null — both must read as unallocated.
    expect(transactionPostingStatus({ ...classified, suggestedGlAccount: "" })).toBe("Unprocessed");
    expect(transactionPostingStatus({ ...classified, suggestedGlAccount: "   " })).toBe("Unprocessed");
  });

  it("recoding to a different account keeps it Ready to Post and changes no amount", () => {
    const first = importedTransaction({ suggestedGlAccount: "3030" });
    const recoded = { ...first, suggestedGlAccount: "3420" };
    expect(transactionPostingStatus(recoded)).toBe("Ready to Post");
    expect(recoded.debit).toBe(first.debit);
    expect(recoded.credit).toBe(first.credit);
  });

  it("a classified transaction builds a balanced journal against the mapped bank GL account", () => {
    const classified = importedTransaction({ suggestedGlAccount: "3030" });
    const built = buildJournalLinesForTransaction(classified, BANK_GL);
    expect(built).toEqual({
      ok: true,
      lines: [
        { accountCode: "3030", debit: 6, credit: 0, description: "Spend Money — Capitec Bank" },
        { accountCode: "1020", debit: 0, credit: 6, description: "Spend Money — Capitec Bank" },
      ],
    });
  });
});

describe("split expense + VAT transaction", () => {
  // R6.00 bank charge at 15%: R5.22 expense + R0.78 VAT.
  const SPLIT_LINES = [
    { amount: 5.22, description: "Bank charges", glAccount: "3030" },
    { amount: 0.78, description: "VAT on bank charges", glAccount: "2100" },
  ];

  it("a split must sum exactly to the transaction amount", () => {
    expect(validateSplitLines(SPLIT_LINES, 6)).toEqual({ ok: true });
    expect(validateSplitLines([{ amount: 5.22, description: "Bank charges", glAccount: "3030" }], 6)).toMatchObject({ ok: false });
    expect(validateSplitLines([...SPLIT_LINES, { amount: 1, description: "extra", glAccount: "3030" }], 6)).toMatchObject({ ok: false });
  });

  it("a split transaction is Ready to Post even with no single GL account on the header", () => {
    const split = importedTransaction({ isSplit: true, suggestedGlAccount: null });
    expect(transactionPostingStatus(split)).toBe("Ready to Post");
  });

  it("posts as expense AND VAT on separate lines — never collapsed into one account", () => {
    const split = importedTransaction({ isSplit: true, suggestedGlAccount: null });
    const built = buildJournalLinesForSplitTransaction(split, SPLIT_LINES, BANK_GL);
    expect(built).toEqual({
      ok: true,
      lines: [
        { accountCode: "3030", debit: 5.22, credit: 0, description: "Bank charges" },
        { accountCode: "2100", debit: 0.78, credit: 0, description: "VAT on bank charges" },
        { accountCode: "1020", debit: 0, credit: 6, description: "Spend Money — Capitec Bank" },
      ],
    });
    if (!built.ok) throw new Error("unreachable");
    const debit = built.lines.reduce((s, l) => s + l.debit, 0);
    const credit = built.lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.round(debit * 100) / 100).toBe(6);
    expect(Math.round(credit * 100) / 100).toBe(6);
    // Two distinct GL accounts on the expense side, not one.
    expect(new Set(built.lines.filter((l) => l.accountCode !== "1020").map((l) => l.accountCode)).size).toBe(2);
  });

  it("the split's total equals the transaction's own amount — the client's figure is untouched", () => {
    const split = importedTransaction({ isSplit: true });
    const total = Math.round(SPLIT_LINES.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    expect(total).toBe(split.debit);
  });

  it("refuses a split whose lines do not sum to the transaction rather than adjusting either", () => {
    const split = importedTransaction({ isSplit: true, suggestedGlAccount: null });
    const wrong = [
      { amount: 5.0, description: "Bank charges", glAccount: "3030" },
      { amount: 0.78, description: "VAT", glAccount: "2100" },
    ];
    const built = buildJournalLinesForSplitTransaction(split, wrong, BANK_GL);
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("unreachable");
    expect(built.reason).toContain("Split lines total 5.78 but the transaction is 6");
  });

  it("a split transaction reaches the posting plan as one balanced journal", () => {
    const split = importedTransaction({ isSplit: true, suggestedGlAccount: null });
    const plan = buildBankPostingPlan([split], context({ splitsByTransactionId: new Map([[2013, SPLIT_LINES]]) }));
    expect(plan.journals).toHaveLength(1);
    expect(plan.journals[0].lines.map((l) => l.accountCode)).toEqual(["3030", "2100", "1020"]);
    expect(plan.notReady).toEqual([]);
  });
});

describe("Unprocessed -> Ready to Post -> Posted, and no automatic posting", () => {
  it("classification alone never posts anything", () => {
    const classified = importedTransaction({ suggestedGlAccount: "3030" });
    // Ready to Post is a readiness statement about a transaction that is
    // still entirely outside the ledger.
    expect(transactionPostingStatus(classified)).toBe("Ready to Post");
    expect(classified.postedFlag).toBe(false);
    expect(classified.postedAt).toBeNull();
    expect(classified.postingBatchId).toBeNull();
    expect(classified.journalId).toBeNull();
  });

  it("building a posting plan is read-only — it reports what WOULD post and mutates nothing", () => {
    const classified = importedTransaction({ suggestedGlAccount: "3030" });
    const snapshot = JSON.stringify(classified);
    const plan = buildBankPostingPlan([classified], context());
    expect(plan.journals).toHaveLength(1);
    expect(JSON.stringify(classified)).toBe(snapshot);
    expect(transactionPostingStatus(classified)).toBe("Ready to Post");
  });

  it("only the posting engine's own flag makes a transaction Posted", () => {
    const classified = importedTransaction({ suggestedGlAccount: "3030" });
    const posted = { ...classified, postedFlag: true, postedAt: "2026-09-09T00:00:00Z", journalId: 900, postingBatchId: 1 };
    expect(transactionPostingStatus(posted)).toBe("Posted");
    const reconciled = { ...posted, reconciliationId: 7 };
    expect(transactionPostingStatus(reconciled)).toBe("Reconciled");
  });

  it("the four states are distinct and ordered, and 'classified' is never 'posted'", () => {
    const unprocessed = importedTransaction();
    const ready = { ...unprocessed, suggestedGlAccount: "3030" };
    const posted = { ...ready, postedFlag: true, journalId: 900 };
    const reconciled = { ...posted, reconciliationId: 7 };
    expect([unprocessed, ready, posted, reconciled].map(transactionPostingStatus)).toEqual([
      "Unprocessed",
      "Ready to Post",
      "Posted",
      "Reconciled",
    ]);
  });
});

describe("source amount preservation", () => {
  it("no classification path changes debit, credit, date, description or the source account", () => {
    const source = importedTransaction();
    const steps = [
      { ...source, suggestedGlAccount: "3030" },
      { ...source, suggestedGlAccount: "3030", suggestedVatCode: "Standard Rated" },
      { ...source, isSplit: true },
      { ...source, suggestedGlAccount: "3420", allocationNotes: "recoded after review" },
      { ...source, reviewStatus: "Approved" as const },
    ];
    for (const step of steps) {
      expect(step.debit).toBe(source.debit);
      expect(step.credit).toBe(source.credit);
      expect(step.transactionDate).toBe(source.transactionDate);
      expect(step.description).toBe(source.description);
      expect(step.glAccount).toBe(source.glAccount);
      expect(step.sourceOccurrence).toBe(source.sourceOccurrence);
    }
  });

  it("a duplicate-preserved row keeps its own identity through classification", () => {
    // Occurrence 2 of an identical pair — classifying one must not
    // collapse it into, or away from, its twin.
    const first = importedTransaction({ id: 2012, sourceOccurrence: 1 });
    const second = importedTransaction({ id: 2013, sourceOccurrence: 2 });
    const classifiedSecond = { ...second, suggestedGlAccount: "3030" };
    expect(classifiedSecond.id).toBe(2013);
    expect(classifiedSecond.sourceOccurrence).toBe(2);
    expect(first.sourceOccurrence).toBe(1);
    expect(classifiedSecond.debit).toBe(first.debit);
    expect(transactionPostingStatus(first)).toBe("Unprocessed");
    expect(transactionPostingStatus(classifiedSecond)).toBe("Ready to Post");
  });

  it("the posted journal's amount equals the source amount exactly", () => {
    const classified = importedTransaction({ suggestedGlAccount: "3030" });
    const plan = buildBankPostingPlan([classified], context());
    const glSide = plan.journals[0].lines.filter((l) => l.accountCode !== "1020");
    expect(Math.round(glSide.reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100).toBe(classified.debit);
  });
});
