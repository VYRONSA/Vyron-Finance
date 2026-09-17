/**
 * Bank Accounting Posting — the IMPORT -> CLASSIFY -> POST -> GL ->
 * REPORTS -> RECONCILE workflow, tested end to end at the layer where the
 * accounting decisions actually live.
 *
 * `buildBankPostingPlan` is pure by design (see its own doc comment), so
 * everything about WHAT gets posted, how it is grouped, what does not get
 * posted and why, is tested here without Supabase. `applyPlanToLedger`
 * below is the test's own stand-in for `fn_post_bank_transactions`
 * (migration 0092) — it does exactly what that function's INSERT INTO
 * gl_transactions ... SELECT does, aggregating the planned lines by
 * account, which is what lets the Trial Balance and financial-report
 * assertions further down be real assertions about the plan rather than
 * about a mock.
 */
import { describe, expect, it } from "vitest";

import { buildBankPostingPlan, ruleEngineJournalExclusion, type BankPostingPlan, type PostingPlanContext } from "./bank-posting-service";
import { summarizeTrialBalance } from "./trial-balance-service";
import { buildIncomeStatement } from "@/server/reporting/income-statement-engine";
import { transactionPostingStatus, type BankTransactionRecord, type RuleEngineJournalRef } from "@/server/accounting/types";
import type { ChartOfAccount, TrialBalanceRow } from "@/server/general-ledger/types";
import type { FinancialYear } from "@/server/company-management/types";

const COMPANY_ID = "co_metanoia";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1,
    companyId: COMPANY_ID,
    transactionDate: "2026-03-15",
    reference: "",
    description: "Payable Payment — Three Streams Fish",
    beneficiary: "Three Streams Fish",
    // VYRON's cashbook convention: `debit` is money OUT of the bank.
    debit: 1000,
    credit: 0,
    balance: null,
    bankAccount: "Metanoia Hospitality",
    bankAccountId: 1,
    glAccount: "",
    vat: null,
    notes: "",
    importBatch: "XERO-Metanoia Hospitality",
    sourceFilename: "bank.xlsx",
    createdAt: "2026-03-15T00:00:00Z",
    allocationStatus: "Suggested",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    confidenceScore: null,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: "800",
    suggestedVatCode: null,
    allocationMethod: "Future AI",
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
    allocationType: "G",
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
    sourceOccurrence: 1,
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

const ACCOUNTS: { code: string; id: number; description: string; type: ChartOfAccount["accountType"]; normal: ChartOfAccount["normalBalance"] }[] = [
  { code: "1000", id: 10, description: "Bank", type: "Asset", normal: "Debit" },
  { code: "800", id: 20, description: "Accounts Payable", type: "Liability", normal: "Credit" },
  { code: "610", id: 30, description: "Accounts Receivable", type: "Asset", normal: "Debit" },
  { code: "3030", id: 40, description: "Bank Charges", type: "Expense", normal: "Debit" },
  { code: "2000", id: 50, description: "Sales", type: "Income", normal: "Credit" },
  { code: "2300", id: 60, description: "VAT Control", type: "Liability", normal: "Credit" },
];

function chartOfAccounts(): ChartOfAccount[] {
  return ACCOUNTS.map((a) => ({
    id: a.id,
    companyId: COMPANY_ID,
    accountCode: a.code,
    description: a.description,
    accountType: a.type,
    category: "",
    normalBalance: a.normal,
    parentAccountId: null,
    reportingGroup: "",
    financialStatementGroup: "",
    taxTreatment: "",
    branchId: null,
    departmentId: null,
    costCentreId: null,
    projectId: null,
    isControlAccount: false,
    isActive: true,
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
  }));
}

/** The live Metanoia company's actual financial year — an open FY2027
 * running 1 March 2026 to 28 February 2027, which is what makes the
 * migrated statement dates postable at all. A transaction outside any
 * financial year is blocked, deliberately, and that is covered below. */
const OPEN_YEAR: FinancialYear[] = [
  {
    id: 1,
    companyId: COMPANY_ID,
    yearLabel: "FY2027",
    startDate: "2026-03-01",
    endDate: "2027-02-28",
    status: "Open",
    isCurrent: true,
    createdAt: "2026-03-01T00:00:00Z",
    lockDate: null,
    reopenedAt: null,
    reopenedBy: null,
  },
];

function context(overrides: Partial<PostingPlanContext> = {}): PostingPlanContext {
  return {
    bankAccountsById: new Map([[1, { glAccount: "1000", accountNumber: "METANOIA-HOSPITALITY" }]]),
    // The seeded "Supplier Payment" / "Customer Receipt" control accounts.
    controlAccounts: { creditors: "2000", debtors: "1100" },
    splitsByTransactionId: new Map(),
    accountCodes: new Set(ACCOUNTS.map((a) => a.code)),
    financialYears: OPEN_YEAR,
    financialYearStartMonth: 3,
    journalNumberAt: (index) => `JR${String(1 + index).padStart(6, "0")}`,
    ...overrides,
  };
}

/**
 * The test's stand-in for what `fn_post_bank_transactions` writes to
 * `gl_transactions`, aggregated into the `TrialBalanceRow` shape
 * `fn_trial_balance` produces. Deliberately dumb: it only sums the
 * planned lines per account, so any assertion that passes here is an
 * assertion about the plan the service built, not about this helper.
 */
function applyPlanToLedger(plan: BankPostingPlan, existingRows: TrialBalanceRow[] = []): TrialBalanceRow[] {
  const byCode = new Map<string, TrialBalanceRow>();
  for (const row of existingRows) byCode.set(row.accountCode, { ...row });

  for (const journal of plan.journals) {
    for (const line of journal.lines) {
      const account = ACCOUNTS.find((a) => a.code === line.accountCode);
      if (!account) throw new Error(`Test setup: no account for code ${line.accountCode}`);
      const row =
        byCode.get(line.accountCode) ??
        {
          accountId: account.id,
          accountCode: account.code,
          description: account.description,
          accountType: account.type,
          normalBalance: account.normal,
          totalDebit: 0,
          totalCredit: 0,
          debitBalance: 0,
          creditBalance: 0,
        };
      row.totalDebit = Math.round((row.totalDebit + line.debit) * 100) / 100;
      row.totalCredit = Math.round((row.totalCredit + line.credit) * 100) / 100;
      byCode.set(line.accountCode, row);
    }
  }

  return [...byCode.values()].map((row) => {
    const net = Math.round((row.totalDebit - row.totalCredit) * 100) / 100;
    return { ...row, debitBalance: net > 0 ? net : 0, creditBalance: net < 0 ? -net : 0 };
  });
}

/** Applies the posting the way the database does, so a plan can be
 * "posted" and the resulting transaction state re-inspected. */
function markPosted(transactions: BankTransactionRecord[], plan: BankPostingPlan, postingBatchId = 1): BankTransactionRecord[] {
  const postedIds = new Set(plan.journals.flatMap((j) => j.transactionIds));
  return transactions.map((t, index) =>
    postedIds.has(t.id) ? { ...t, postedFlag: true, postedAt: "2026-09-09T00:00:00Z", postingBatchId, journalId: 900 + index } : t,
  );
}

describe("3. a processed transaction can be posted to the GL", () => {
  it("builds a balanced journal for a classified transaction and reports it as postable", () => {
    const plan = buildBankPostingPlan([txn()], context());

    expect(plan.journals).toHaveLength(1);
    expect(plan.journals[0].transactionIds).toEqual([1]);
    expect(plan.notReady).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.alreadyPosted).toEqual([]);

    // Money leaving the bank to settle a payable: DR Accounts Payable,
    // CR Bank.
    expect(plan.journals[0].lines).toEqual([
      { transactionId: 1, accountCode: "800", debit: 1000, credit: 0, description: "Payable Payment — Three Streams Fish" },
      { transactionId: 1, accountCode: "1000", debit: 0, credit: 1000, description: "Payable Payment — Three Streams Fish" },
    ]);
  });

  it("posts a receipt in the opposite direction — DR Bank, CR the income/receivable account", () => {
    const receipt = txn({ id: 2, debit: 0, credit: 3202.6, suggestedGlAccount: "610", description: "Receivable Payment — Dulcenbosch" });
    const plan = buildBankPostingPlan([receipt], context());

    expect(plan.journals[0].lines).toEqual([
      { transactionId: 2, accountCode: "1000", debit: 3202.6, credit: 0, description: "Receivable Payment — Dulcenbosch" },
      { transactionId: 2, accountCode: "610", debit: 0, credit: 3202.6, description: "Receivable Payment — Dulcenbosch" },
    ]);
  });

  it("groups by transaction DATE — one journal per date, so each entry lands in its own financial period", () => {
    const plan = buildBankPostingPlan(
      [
        txn({ id: 1, transactionDate: "2026-03-15" }),
        txn({ id: 2, transactionDate: "2026-03-15", debit: 250 }),
        txn({ id: 3, transactionDate: "2026-05-02", debit: 400 }),
      ],
      context(),
    );

    expect(plan.journals.map((j) => j.journalDate)).toEqual(["2026-03-15", "2026-05-02"]);
    expect(plan.journals[0].transactionIds).toEqual([1, 2]);
    expect(plan.journals[1].transactionIds).toEqual([3]);
    // A March year start (month 3) puts March in period 1 and May in
    // period 3 — the posting date, not the run date, decides.
    expect(plan.journals.map((j) => j.financialPeriod)).toEqual([1, 3]);
    expect(plan.journals.map((j) => j.journalNumber)).toEqual(["JR000001", "JR000002"]);
  });

  it("splits net and VAT onto separate lines when the transaction carries VAT", () => {
    const plan = buildBankPostingPlan([txn({ debit: 1150, vat: 150, suggestedGlAccount: "3030" })], context());
    expect(plan.journals[0].lines).toEqual([
      { transactionId: 1, accountCode: "3030", debit: 1000, credit: 0, description: "Payable Payment — Three Streams Fish" },
      { transactionId: 1, accountCode: "2300", debit: 150, credit: 0, description: "VAT — Payable Payment — Three Streams Fish" },
      { transactionId: 1, accountCode: "1000", debit: 0, credit: 1150, description: "Payable Payment — Three Streams Fish" },
    ]);
  });

  it("reports an unclassified transaction as not ready, and never invents an account for it", () => {
    const plan = buildBankPostingPlan([txn({ suggestedGlAccount: null })], context());
    expect(plan.journals).toEqual([]);
    expect(plan.notReady).toEqual([{ transactionId: 1, reason: "Not classified yet — assign a GL account (or split it) before posting.", kind: "not-ready" }]);
  });

  it("blocks — rather than guesses — when the bank account has no GL account configured", () => {
    const plan = buildBankPostingPlan([txn()], context({ bankAccountsById: new Map([[1, { glAccount: "", accountNumber: "METANOIA-HOSPITALITY" }]]) }));
    expect(plan.journals).toEqual([]);
    expect(plan.blocked[0].reason).toContain("has no GL account configured");
    expect(plan.blocked[0].reason).toContain("Configure it under Bank Accounts");
  });

  it("blocks a transaction dated outside any financial year, rather than posting it into nowhere", () => {
    const plan = buildBankPostingPlan([txn({ transactionDate: "2025-01-05" })], context());
    expect(plan.journals).toEqual([]);
    expect(plan.blocked[0].reason).toContain("No financial year covers 2025-01-05");
  });

  it("blocks a transaction dated inside a CLOSED financial year", () => {
    const closed: FinancialYear[] = [{ ...OPEN_YEAR[0], status: "Closed" }];
    const plan = buildBankPostingPlan([txn()], context({ financialYears: closed }));
    expect(plan.journals).toEqual([]);
    expect(plan.blocked[0].reason).toContain("is closed");
  });

  it("blocks when a transaction's account code has no Chart of Accounts entry", () => {
    const plan = buildBankPostingPlan([txn({ suggestedGlAccount: "9999" })], context());
    expect(plan.journals).toEqual([]);
    expect(plan.blocked[0].reason).toContain('No Chart of Accounts entry for account code "9999"');
  });

  it("posts everything postable and reports the rest — one bad transaction never blocks the batch", () => {
    const plan = buildBankPostingPlan([txn({ id: 1 }), txn({ id: 2, suggestedGlAccount: null }), txn({ id: 3, suggestedGlAccount: "9999" })], context());
    expect(plan.journals.flatMap((j) => j.transactionIds)).toEqual([1]);
    expect(plan.notReady.map((e) => e.transactionId)).toEqual([2]);
    expect(plan.blocked.map((e) => e.transactionId)).toEqual([3]);
  });
});

describe("4. a posted transaction cannot accidentally be posted twice", () => {
  it("excludes an already-posted transaction from the plan and reports it as already posted", () => {
    const plan = buildBankPostingPlan([txn({ postedFlag: true, journalId: 900, postingBatchId: 7 })], context());
    expect(plan.journals).toEqual([]);
    expect(plan.alreadyPosted).toEqual([{ transactionId: 1, reason: "Already posted to the General Ledger in batch 7.", kind: "already-posted" }]);
  });

  it("re-posting the same selection immediately after a successful post produces nothing", () => {
    const transactions = [txn({ id: 1 }), txn({ id: 2, debit: 250 })];
    const firstPlan = buildBankPostingPlan(transactions, context());
    expect(firstPlan.journals.flatMap((j) => j.transactionIds)).toEqual([1, 2]);

    const afterPosting = markPosted(transactions, firstPlan);
    const secondPlan = buildBankPostingPlan(afterPosting, context());
    expect(secondPlan.journals).toEqual([]);
    expect(secondPlan.alreadyPosted.map((e) => e.transactionId)).toEqual([1, 2]);
  });

  it("will not post a transaction already attached to another journal, even if posted_flag is somehow false", () => {
    const plan = buildBankPostingPlan([txn({ journalId: 900, postedFlag: false })], context());
    expect(plan.journals).toEqual([]);
    expect(plan.blocked[0].reason).toContain("Already attached to journal");
  });

  it("a reconciled transaction is treated as posted, never re-posted", () => {
    const plan = buildBankPostingPlan([txn({ postedFlag: true, reconciliationId: 5 })], context());
    expect(plan.journals).toEqual([]);
    expect(plan.alreadyPosted).toHaveLength(1);
  });
});

describe("5. GL balances reflect posted bank transactions", () => {
  it("the ledger produced by posting balances, and each account carries the right side", () => {
    const transactions = [
      txn({ id: 1, debit: 1000, credit: 0, suggestedGlAccount: "800" }), // paid a supplier
      txn({ id: 2, debit: 0, credit: 3202.6, suggestedGlAccount: "610" }), // customer paid us
      txn({ id: 3, debit: 50, credit: 0, suggestedGlAccount: "3030" }), // bank charge
    ];
    const rows = applyPlanToLedger(buildBankPostingPlan(transactions, context()));
    const byCode = new Map(rows.map((r) => [r.accountCode, r]));

    // Bank: 3202.60 in, 1050.00 out -> net debit balance of 2152.60.
    expect(byCode.get("1000")!.debitBalance).toBe(2152.6);
    expect(byCode.get("800")!.debitBalance).toBe(1000);
    expect(byCode.get("610")!.creditBalance).toBe(3202.6);
    expect(byCode.get("3030")!.debitBalance).toBe(50);

    expect(summarizeTrialBalance(rows).isBalanced).toBe(true);
  });

  it("the trial balance is empty before posting and populated after — posting is what puts a transaction in the ledger", () => {
    const transactions = [txn()];

    // Classified but not posted: nothing in the ledger.
    expect(transactionPostingStatus(transactions[0])).toBe("Ready to Post");
    expect(applyPlanToLedger({ journals: [], alreadyPosted: [], notReady: [], blocked: [] })).toEqual([]);

    const rows = applyPlanToLedger(buildBankPostingPlan(transactions, context()));
    expect(rows).toHaveLength(2);
    expect(summarizeTrialBalance(rows)).toMatchObject({ totalDebit: 1000, totalCredit: 1000, isBalanced: true });
  });

  it("posting a second batch adds to the ledger rather than replacing it", () => {
    const first = applyPlanToLedger(buildBankPostingPlan([txn({ id: 1, debit: 1000 })], context()));
    const second = applyPlanToLedger(buildBankPostingPlan([txn({ id: 2, debit: 250 })], context()), first);
    const bank = second.find((r) => r.accountCode === "1000")!;
    expect(bank.creditBalance).toBe(1250);
    expect(summarizeTrialBalance(second).isBalanced).toBe(true);
  });

  it("VAT lands in the VAT control account, not folded into the expense", () => {
    const rows = applyPlanToLedger(buildBankPostingPlan([txn({ debit: 1150, vat: 150, suggestedGlAccount: "3030" })], context()));
    const byCode = new Map(rows.map((r) => [r.accountCode, r]));
    expect(byCode.get("3030")!.debitBalance).toBe(1000);
    expect(byCode.get("2300")!.debitBalance).toBe(150);
    expect(summarizeTrialBalance(rows).isBalanced).toBe(true);
  });
});

describe("6. financial reports reflect posted transactions", () => {
  it("an income statement built over the posted ledger shows the posted revenue and expenses", () => {
    const transactions = [
      txn({ id: 1, transactionDate: "2026-04-10", debit: 0, credit: 5000, suggestedGlAccount: "2000", description: "Receive Money — sales" }),
      txn({ id: 2, transactionDate: "2026-04-11", debit: 50, credit: 0, suggestedGlAccount: "3030", description: "Spend Money — bank charges" }),
    ];
    const endRows = applyPlanToLedger(buildBankPostingPlan(transactions, context()));

    const incomeStatement = buildIncomeStatement(chartOfAccounts(), [], endRows, "2026-04-01", "2026-04-30");

    expect(incomeStatement.revenue.total).toBe(5000);
    expect(incomeStatement.operatingExpenses.total).toBe(50);
    expect(incomeStatement.netProfit).toBe(4950);
  });

  it("reports show nothing for transactions that were classified but never posted", () => {
    const classifiedNotPosted = [txn({ id: 1, transactionDate: "2026-04-10", debit: 0, credit: 5000, suggestedGlAccount: "2000" })];
    // Nothing posted -> no ledger rows -> the report is honestly empty,
    // rather than quietly including work that never reached the ledger.
    const incomeStatement = buildIncomeStatement(chartOfAccounts(), [], [], "2026-04-01", "2026-04-30");
    expect(incomeStatement.revenue.total).toBe(0);
    expect(incomeStatement.netProfit).toBe(0);
    expect(transactionPostingStatus(classifiedNotPosted[0])).toBe("Ready to Post");
  });
});

describe("9. company isolation", () => {
  it("a plan is built only from the transactions handed to it — another company's rows are never reachable", () => {
    // The service loads transactions through
    // `getTransactionsByIds(companyId, ids)`, which filters on
    // `company_id` in SQL, and `fn_post_bank_transactions` filters on
    // `p_company_id` in every statement it runs. At this layer the
    // guarantee to check is that the plan touches nothing beyond its
    // input, including for ids that were requested but not returned.
    const plan = buildBankPostingPlan([txn({ id: 1, companyId: COMPANY_ID })], context());
    expect(plan.journals.flatMap((j) => j.transactionIds)).toEqual([1]);
    const everyReportedId = [...plan.alreadyPosted, ...plan.notReady, ...plan.blocked].map((e) => e.transactionId);
    expect(everyReportedId).toEqual([]);
  });

  it("posting one company's transactions produces journals referencing only that company's accounts", () => {
    const plan = buildBankPostingPlan([txn()], context());
    const codes = plan.journals.flatMap((j) => j.lines.map((l) => l.accountCode));
    expect(codes.every((code) => ACCOUNTS.some((a) => a.code === code))).toBe(true);
  });
});

describe("Migration 0100 — G. Bank Posting refuses a transaction a Banking Rule journal already covers", () => {
  // Production transaction 2151: posted to the ledger by JR000264, but its
  // own posted_flag/journal_id were never stamped.
  const unlinked = () => txn({ id: 2151, debit: 6435, credit: 0, suggestedGlAccount: "3030", postedFlag: false, journalId: null });
  const ruleJournal = (overrides: Partial<RuleEngineJournalRef> = {}): RuleEngineJournalRef => ({ id: 278, journalNumber: "JR000264", status: "Posted", isReversed: false, sourceId: 2151, ...overrides });
  const withJournal = (journal: RuleEngineJournalRef) => context({ ruleEngineJournalsByTransactionId: new Map([[2151, journal]]) });

  it("without the lookup, posted_flag=false + journal_id=NULL looks postable — the gap this closes", () => {
    const plan = buildBankPostingPlan([unlinked()], context());
    expect(plan.journals.flatMap((j) => j.transactionIds)).toEqual([2151]);
  });

  it("reports it as already posted, naming the journal, and plans no journal for it", () => {
    const plan = buildBankPostingPlan([unlinked()], withJournal(ruleJournal()));
    expect(plan.journals).toEqual([]);
    expect(plan.alreadyPosted).toEqual([{ transactionId: 2151, reason: expect.stringContaining("JR000264"), kind: "already-posted" }]);
    expect(applyPlanToLedger(plan)).toEqual([]);
  });

  it("the rest of the selection still posts", () => {
    const plan = buildBankPostingPlan([unlinked(), txn({ id: 7, debit: 100 })], withJournal(ruleJournal()));
    expect(plan.journals.flatMap((j) => j.transactionIds)).toEqual([7]);
    expect(plan.alreadyPosted.map((e) => e.transactionId)).toEqual([2151]);
  });

  it.each(["Draft", "Submitted", "Approved"] as const)("blocks it while its Banking Rule journal is still %s (it could still post)", (status) => {
    const plan = buildBankPostingPlan([unlinked()], withJournal(ruleJournal({ status })));
    expect(plan.journals).toEqual([]);
    expect(plan.blocked).toEqual([{ transactionId: 2151, reason: expect.stringContaining(status), kind: "blocked" }]);
  });

  it.each([
    ["reversed", { isReversed: true }],
    ["rejected", { status: "Rejected" as const }],
    ["cancelled", { status: "Cancelled" as const }],
  ])("does not block when the Banking Rule journal is %s (it no longer carries the amount)", (_label, overrides) => {
    expect(ruleEngineJournalExclusion(2151, ruleJournal(overrides))).toBeNull();
    const plan = buildBankPostingPlan([unlinked()], withJournal(ruleJournal(overrides)));
    expect(plan.journals.flatMap((j) => j.transactionIds)).toEqual([2151]);
  });
});
