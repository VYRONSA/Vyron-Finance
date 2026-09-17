import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

// The real repository module (its pure helpers — the worklist cursor, the
// claim builder — are part of what is under test), with its database
// calls replaced.
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { throw new Error("no database in unit tests"); } }));
vi.mock("@/server/repositories/transaction-explorer-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/repositories/transaction-explorer-repository")>()),
  applyRuleActions: vi.fn(),
  getTransactionsByIds: vi.fn(),
  listRuleEngineWorklistPage: vi.fn(),
  listRuleEngineRecoveryCandidates: vi.fn(),
  countUnprocessedTransactions: vi.fn(),
}));
vi.mock("@/server/repositories/banking-rule-repository", () => ({ recordRuleApplication: vi.fn(), listActiveBankingRules: vi.fn(), getBankingRule: vi.fn() }));
vi.mock("@/server/repositories/banking-exception-repository", () => ({ raiseExceptionIdempotent: vi.fn(), listTransactionIdsWithOpenException: vi.fn() }));
vi.mock("@/server/repositories/merchant-repository", () => ({}));
vi.mock("@/server/repositories/bank-account-repository", () => ({ getBankAccount: vi.fn() }));
vi.mock("@/server/repositories/journal-repository", () => ({ listRuleEngineJournalsForTransactions: vi.fn() }));
vi.mock("@/server/repositories/posting-repository", () => ({ postRuleEngineJournalAtomic: vi.fn(), recoverRuleEngineJournalLink: vi.fn() }));
vi.mock("@/server/repositories/financial-year-repository", () => ({ listFinancialYears: vi.fn() }));
vi.mock("@/server/repositories/chart-of-accounts-repository", () => ({ listChartOfAccounts: vi.fn() }));
vi.mock("@/server/repositories/company-repository", () => ({ getCompany: vi.fn() }));
vi.mock("@/server/auth/require-session", () => ({ getPerformedByLabel: vi.fn() }));
// The old, non-atomic path must never be reached again.
vi.mock("@/server/services/posting-engine-service", () => ({ postApprovedJournals: vi.fn(() => { throw new Error("postApprovedJournals must not be called by the rule engine"); }) }));

import {
  applyRulesToTransactions,
  DEFAULT_RULE_ENGINE_MAX_POSTINGS,
  isClaimableByRule,
  isRuleOwnedAwaitingReview,
  processTransaction,
  runRuleEngine,
  toEvaluable,
  type RuleEnginePostingContext,
} from "./rule-processing-service";
import { matchesCondition } from "@/server/banking-rules/rule-engine";
import * as explorerRepo from "@/server/repositories/transaction-explorer-repository";
import * as ruleRepo from "@/server/repositories/banking-rule-repository";
import * as exceptionRepo from "@/server/repositories/banking-exception-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import * as postingRepo from "@/server/repositories/posting-repository";
import * as financialYearRepo from "@/server/repositories/financial-year-repository";
import * as chartOfAccountsRepo from "@/server/repositories/chart-of-accounts-repository";
import { getCompany } from "@/server/repositories/company-repository";
import { getPerformedByLabel } from "@/server/auth/require-session";
import type { BankAccount, BankTransactionRecord, RuleEngineJournalRef } from "@/server/accounting/types";
import type { BankingRuleCondition, BankingRule } from "@/server/banking-rules/types";
import type { FinancialYear } from "@/server/company-management/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { Company } from "@/server/company-management/types";
import type { RuleEngineJournalInput, RuleEngineJournalOutcome } from "@/server/repositories/posting-repository";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 1,
    companyId: "co_1",
    transactionDate: "2026-07-01",
    reference: "REF-1",
    description: "Payment to ABC Supplies",
    beneficiary: "ABC Supplies",
    debit: 500,
    credit: 0,
    balance: null,
    bankAccount: "MAIN-001",
    bankAccountId: 1,
    glAccount: "6000",
    vat: null,
    notes: "",
    importBatch: "",
    sourceFilename: "",
    createdAt: "2026-07-01T00:00:00Z",
    allocationStatus: "Matched",
    matchedSupplierId: 1,
    matchedSupplierName: "ABC Supplies",
    matchedBillId: 1,
    confidenceScore: 98,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: "6000",
    suggestedVatCode: "Standard",
    allocationMethod: "Matched Bill",
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

/** A freshly imported Salaries payment no rule, match or person owns yet —
 * the shape of production transaction 2151 before the sweep reached it. */
function freshSalary(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return txn({
    id: 2151,
    transactionDate: "2026-03-27",
    reference: "",
    description: "Spend Money — Salaries",
    beneficiary: "Salaries",
    debit: 6435,
    bankAccount: "Metanoia Hospitality",
    bankAccountId: 3,
    glAccount: "3420 - Salaries and wages",
    allocationStatus: "Unallocated",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    confidenceScore: null,
    suggestedGlAccount: null,
    suggestedVatCode: null,
    allocationMethod: null,
    ...overrides,
  });
}

/** An imported payment no rule recognises (Northwood's 181 claimable rows). */
function unmatched(id: number, overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return freshSalary({ id, beneficiary: `Unknown payee ${id}`, description: `Card purchase ${id}`, debit: 100 + (id % 50), ...overrides });
}

/** LEGACY fixture marker: a row a rule classified under the OLD system
 * (before rules posted automatically) and nobody posted — Northwood's ~562
 * rows. It carries an active, still-matching rule and a real GL account, so
 * a blanket "retry rule-owned rows" would post it. */
function legacyRuleOwned(id: number, overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return freshSalary({
    id,
    transactionDate: "2026-08-21",
    ruleId: 153,
    allocationStatus: "Suggested",
    allocationType: "G",
    suggestedGlAccount: "6940",
    suggestedVatCode: "No VAT",
    allocationReason: 'Resolved by rule "Auto: Salaries → GL"',
    ...overrides,
  });
}

/** The state an interrupted post left 2151 in: the rule owns it, no link. */
function interruptedSalary(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return freshSalary({ ruleId: 153, allocationStatus: "Suggested", suggestedGlAccount: "6940", suggestedVatCode: "No VAT", ...overrides });
}

function condition(overrides: Partial<BankingRuleCondition> = {}): BankingRuleCondition {
  return { id: 1, field: "beneficiary", operator: "equals", value: "", value2: null, ...overrides };
}

const SALARIES_RULE: BankingRule = {
  id: 153,
  companyId: "co_1",
  domain: "Banking",
  ruleType: "GL",
  name: "Auto: Salaries → GL",
  description: "",
  priority: 1,
  isActive: true,
  version: 1,
  createdAt: "2026-09-16T00:00:00Z",
  updatedAt: "2026-09-16T00:00:00Z",
  createdBy: "test",
  updatedBy: "test",
  conditions: [condition({ field: "beneficiary", operator: "equals", value: "Salaries" })],
  actions: [
    { id: 1, actionType: "set_gl_account", targetId: null, targetText: "6940" },
    { id: 2, actionType: "set_vat_code", targetId: null, targetText: "No VAT" },
  ],
};
const FLAG_RULE: BankingRule = {
  ...SALARIES_RULE,
  id: 154,
  name: "Review salaries",
  ruleType: "Payroll",
  actions: [{ id: 3, actionType: "flag_for_review", targetId: null, targetText: "Check payroll first" }],
};
const SUPPLIER_RULE: BankingRule = {
  ...SALARIES_RULE,
  id: 155,
  name: "Salaries bureau",
  ruleType: "Supplier",
  actions: [{ id: 4, actionType: "set_supplier", targetId: 77, targetText: null }],
};
const NO_RULES: BankingRule[] = [];

const BANK_ACCOUNTS_BY_ID = new Map([
  [1, { glAccount: "1000", accountNumber: "MAIN-001" }],
  [3, { glAccount: "1020", accountNumber: "METANOIA-HOSPITALITY" }],
]);

const TODAY = new Date().toISOString().slice(0, 10);
const OPEN_YEAR: FinancialYear = {
  id: 1, companyId: "co_1", yearLabel: "FY-OPEN", startDate: "2000-01-01", endDate: "2999-12-31", status: "Open", isCurrent: true,
  createdAt: "2026-01-01T00:00:00Z", lockDate: null, reopenedAt: null,
} as FinancialYear;

function postingContext(overrides: Partial<RuleEnginePostingContext> = {}): RuleEnginePostingContext {
  return { financialYears: [OPEN_YEAR], financialYearStartMonth: 3, accountCodes: new Set(["1000", "1020", "6000", "6940", "2300"]), postedBy: "System", ...overrides };
}

function postedJournal(overrides: Partial<RuleEngineJournalRef> = {}): RuleEngineJournalRef {
  return { id: 278, journalNumber: "JR000264", status: "Posted", isReversed: false, sourceId: 2151, ...overrides };
}

function rpcOutcome(overrides: Partial<RuleEngineJournalOutcome> = {}): RuleEngineJournalOutcome {
  return { outcome: "posted", transactionId: 2151, journalId: 900, journalNumber: "JR000900", journalStatus: "Posted", batchId: 800, batchNumber: "PB000800", reason: null, ...overrides };
}

const SALARY_CLAIM = {
  ruleName: "Auto: Salaries → GL",
  matchedRuleIds: [153],
  suggestedGlAccount: "6940",
  suggestedVatCode: "No VAT",
  ruleId: 153,
  allocationStatus: "Suggested",
};

beforeEach(() => {
  vi.mocked(explorerRepo.applyRuleActions).mockReset().mockResolvedValue(true);
  vi.mocked(explorerRepo.getTransactionsByIds).mockReset().mockResolvedValue([]);
  vi.mocked(explorerRepo.listRuleEngineWorklistPage).mockReset().mockResolvedValue([]);
  vi.mocked(explorerRepo.listRuleEngineRecoveryCandidates).mockReset().mockResolvedValue([]);
  vi.mocked(explorerRepo.countUnprocessedTransactions).mockReset().mockResolvedValue(0);
  vi.mocked(ruleRepo.recordRuleApplication).mockReset().mockRejectedValue(new Error("rule applications are recorded by the claim now"));
  vi.mocked(ruleRepo.listActiveBankingRules).mockReset().mockResolvedValue([SALARIES_RULE]);
  vi.mocked(ruleRepo.getBankingRule).mockReset().mockResolvedValue(null);
  vi.mocked(exceptionRepo.raiseExceptionIdempotent).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(exceptionRepo.listTransactionIdsWithOpenException).mockReset().mockResolvedValue(new Set());
  vi.mocked(bankAccountRepo.getBankAccount).mockReset().mockImplementation(async (_co, id) => ({ id, glAccount: id === 3 ? "1020" : "1000", accountNumber: `ACC-${id}` }) as BankAccount);
  vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockReset().mockResolvedValue(new Map());
  vi.mocked(postingRepo.postRuleEngineJournalAtomic).mockReset().mockResolvedValue(rpcOutcome());
  vi.mocked(postingRepo.recoverRuleEngineJournalLink).mockReset().mockResolvedValue(rpcOutcome({ outcome: "recovered", journalId: 278, journalNumber: "JR000264", batchId: null, batchNumber: null }));
  vi.mocked(financialYearRepo.listFinancialYears).mockReset().mockResolvedValue([OPEN_YEAR]);
  vi.mocked(chartOfAccountsRepo.listChartOfAccounts).mockReset().mockResolvedValue(["1000", "1020", "6000", "6940", "2300"].map((accountCode, i) => ({ id: i + 1, accountCode }) as ChartOfAccount));
  vi.mocked(getCompany).mockReset().mockResolvedValue({ financialYearStartMonth: 3 } as Company);
  vi.mocked(getPerformedByLabel).mockReset().mockResolvedValue("System");
});

/**
 * An in-memory company: the worklist functions behave like migration 0100's
 * (keyset pages of at most 1,000 rows, newest date first, the claim guard),
 * and the claim / posting / recovery calls change the rows the way the
 * database would — so a sweep can be run end to end, repeatedly.
 */
function installCompany(rows: BankTransactionRecord[], options: { journals?: Map<number, RuleEngineJournalRef>; failPosting?: (id: number) => Error | null } = {}) {
  const store = new Map(rows.map((t) => [t.id, { ...t }]));
  const journals = new Map(options.journals ?? []);
  const openUnknown = new Set<number>();
  const pageRequests: { claimableOnly: boolean; limit: number }[] = [];
  const postingCalls: number[] = [];
  const claimCalls: number[] = [];
  const postedDates: { journalDate: string; postingDate: string }[] = [];
  let nextJournalId = 5000;

  const sortKey = (t: BankTransactionRecord) => t.transactionDate || "infinity";
  const newestFirst = (a: BankTransactionRecord, b: BankTransactionRecord) =>
    sortKey(a) === sortKey(b) ? b.id - a.id : sortKey(a) < sortKey(b) ? 1 : -1;
  const claim = (t: BankTransactionRecord, fields: Record<string, unknown>) => {
    t.ruleId = fields.ruleId as number;
    if (fields.suggestedGlAccount !== undefined) t.suggestedGlAccount = fields.suggestedGlAccount as string;
    if (fields.matchedSupplierId !== undefined) t.matchedSupplierId = fields.matchedSupplierId as number;
    t.allocationStatus = fields.allocationStatus as BankTransactionRecord["allocationStatus"];
    t.allocationMethod = null;
  };

  vi.mocked(explorerRepo.listRuleEngineWorklistPage).mockImplementation(async (_co, { claimableOnly, after, limit }) => {
    pageRequests.push({ claimableOnly, limit });
    if (limit > 1000) throw new Error("the API returns at most 1,000 rows");
    return [...store.values()]
      .filter((t) => t.journalId === null && (!claimableOnly || isClaimableByRule(t)))
      .sort(newestFirst)
      .filter((t) => !after || sortKey(t) < after.sortDate || (sortKey(t) === after.sortDate && t.id < after.id))
      .slice(0, limit)
      .map((t) => ({ ...t }));
  });
  vi.mocked(explorerRepo.countUnprocessedTransactions).mockImplementation(async () => [...store.values()].filter((t) => t.journalId === null).length);
  vi.mocked(explorerRepo.listRuleEngineRecoveryCandidates).mockImplementation(async (_co, limit) =>
    [...store.values()]
      .filter((t) => t.journalId === null && !t.postedFlag && t.reconciliationId === null && journals.get(t.id)?.status === "Posted" && !journals.get(t.id)?.isReversed)
      .sort((a, b) => a.id - b.id)
      .slice(0, Math.min(limit, 1000))
      .map((t) => ({ ...t })),
  );
  vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockImplementation(async (_co, ids) => new Map(ids.filter((id) => journals.has(id)).map((id) => [id, journals.get(id)!])));
  vi.mocked(exceptionRepo.listTransactionIdsWithOpenException).mockImplementation(async (_co, _type, ids) => new Set(ids.filter((id) => openUnknown.has(id))));
  vi.mocked(exceptionRepo.raiseExceptionIdempotent).mockImplementation(async (_co, input) => {
    if (input.exceptionType === "UnknownMerchant") openUnknown.add(input.bankTransactionId);
    return undefined as never;
  });
  vi.mocked(explorerRepo.applyRuleActions).mockImplementation(async (_co, id, fields) => {
    claimCalls.push(id);
    const t = store.get(id)!;
    if (!isClaimableByRule(t)) return false;
    claim(t, fields as Record<string, unknown>);
    return true;
  });
  vi.mocked(postingRepo.postRuleEngineJournalAtomic).mockImplementation(async (_co, id, journal: RuleEngineJournalInput, _by, postingDate, claimJson) => {
    postingCalls.push(id);
    const t = store.get(id)!;
    const existing = journals.get(id);
    if (existing) {
      t.journalId = existing.id;
      t.postedFlag = true;
      return rpcOutcome({ outcome: "recovered", transactionId: id, journalId: existing.id });
    }
    if (!isClaimableByRule(t)) return rpcOutcome({ outcome: "not_eligible", transactionId: id, journalId: null, reason: "no longer claimable" });
    const failure = options.failPosting?.(id) ?? null;
    if (failure) throw failure; // the database rolls the claim back with everything else
    claim(t, claimJson);
    const journalId = nextJournalId++;
    journals.set(id, { id: journalId, journalNumber: `JR${journalId}`, status: "Posted", isReversed: false, sourceId: id });
    t.journalId = journalId;
    t.postedFlag = true;
    postedDates.push({ journalDate: journal.journalDate, postingDate });
    return rpcOutcome({ transactionId: id, journalId });
  });
  vi.mocked(postingRepo.recoverRuleEngineJournalLink).mockImplementation(async (_co, id) => {
    const t = store.get(id)!;
    const existing = journals.get(id)!;
    if (t.journalId === existing.id) return rpcOutcome({ outcome: "already_linked", transactionId: id, journalId: existing.id });
    t.journalId = existing.id;
    t.postedFlag = true;
    return rpcOutcome({ outcome: "recovered", transactionId: id, journalId: existing.id });
  });

  return { store, journals, openUnknown, pageRequests, postingCalls, claimCalls, postedDates };
}

function clock(stepMs: number, startMs = 1_000_000) {
  let t = startMs;
  return () => {
    const now = t;
    t += stepMs;
    return now;
  };
}

describe("toEvaluable — Finding #005", () => {
  it("exposes bank_account and gl_account under both the camelCase and CONDITION_FIELDS snake_case spellings", () => {
    const record = toEvaluable(txn({ bankAccount: "MAIN-001", glAccount: "6000" }));
    expect(record.bankAccount).toBe("MAIN-001");
    expect(record.bank_account).toBe("MAIN-001");
    expect(record.glAccount).toBe("6000");
    expect(record.gl_account).toBe("6000");
  });

  it("a rule condition on the UI's snake_case bank_account field actually matches (the bug this finding reports)", () => {
    const record = toEvaluable(txn({ bankAccount: "MAIN-001" }));
    expect(matchesCondition(record, condition({ field: "bank_account", operator: "equals", value: "MAIN-001" }))).toBe(true);
  });

  it("a rule condition on the UI's snake_case gl_account field actually matches", () => {
    const record = toEvaluable(txn({ glAccount: "6000" }));
    expect(matchesCondition(record, condition({ field: "gl_account", operator: "equals", value: "6000" }))).toBe(true);
  });
});

describe("isClaimableByRule — mirrors fn_bank_transaction_is_claimable_by_rule", () => {
  it("accepts an untouched transaction and one carrying only an unconfirmed AI suggestion", () => {
    expect(isClaimableByRule(freshSalary())).toBe(true);
    expect(isClaimableByRule(freshSalary({ allocationStatus: "Suggested", suggestedGlAccount: "3420", allocationMethod: "Future AI" }))).toBe(true);
  });

  it.each([
    ["already linked to a journal", { journalId: 5 }],
    ["manually overridden", { isManualOverride: true }],
    ["on review hold", { reviewHold: true }],
    ["already owned by a rule (the interrupted-post state)", { ruleId: 153 }],
    ["matched to a supplier", { matchedSupplierId: 9 }],
    ["matched to a customer", { matchedCustomerId: 9 }],
    ["matched to a merchant", { matchedMerchantId: 9 }],
    ["carrying a non-AI suggestion", { allocationStatus: "Suggested" as const, suggestedGlAccount: "3420", allocationMethod: "Matched Bill" }],
    ["a Manual Cashbook entry (H2)", { entrySource: "Manual" as const, captureStatus: "Draft" as const }],
    ["a Manual Cashbook entry even with an AI suggestion (H2)", { entrySource: "Manual" as const, allocationMethod: "Future AI", suggestedGlAccount: "3420" }],
  ])("refuses a transaction %s", (_label, overrides) => {
    expect(isClaimableByRule(freshSalary(overrides as Partial<BankTransactionRecord>))).toBe(false);
  });
});

describe("isClaimableByRule — kept in step with the SQL definition (review L6)", () => {
  it("fn_bank_transaction_is_claimable_by_rule checks exactly the same conditions", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0100_atomic_rule_engine_posting.sql"), "utf8");
    const body = /create or replace function fn_bank_transaction_is_claimable_by_rule[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? "";
    const conditions = body.replace(/\s+/g, " ").trim();
    expect(conditions).toBe(
      "select p_txn.journal_id is null and p_txn.is_manual_override = false and p_txn.rule_id is null and p_txn.matched_supplier_id is null " +
        "and p_txn.matched_customer_id is null and p_txn.matched_merchant_id is null and p_txn.review_hold = false and p_txn.entry_source <> 'Manual' " +
        "and ((p_txn.allocation_status = 'Unallocated' and p_txn.suggested_gl_account is null) or p_txn.allocation_method = 'Future AI');",
    );
    // Each of those conditions has its own case in the table above; if this
    // string changes, update isClaimableByRule and that table together.
  });
});

describe("processTransaction — A. claim and post are one atomic call", () => {
  it("posts ONLY this transaction's journal through fn_post_rule_engine_journal, with the same lines, date and period as before, and the claim inside it", async () => {
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "Scheduler (cron)", { ruleEngineJournal: null, postingContext: postingContext() });

    expect(result).toEqual({ transactionId: 2151, matchedRuleIds: [153], autoPosted: true, journalId: 900, exceptionsRaised: [], postingAttempted: true });
    expect(postingRepo.postRuleEngineJournalAtomic).toHaveBeenCalledTimes(1);
    expect(postingRepo.postRuleEngineJournalAtomic).toHaveBeenCalledWith(
      "co_1",
      2151,
      {
        journalDate: TODAY,
        journalType: "Bank Transaction Automation",
        description: 'Automated from rule "Auto: Salaries → GL" — Spend Money — Salaries',
        reference: "",
        financialYearLabel: expect.any(String),
        financialPeriod: expect.any(Number),
        lines: [
          { accountCode: "6940", debit: 6435, credit: 0, description: "Spend Money — Salaries" },
          { accountCode: "1020", debit: 0, credit: 6435, description: "Spend Money — Salaries" },
        ],
      },
      "System",
      TODAY,
      { ...SALARY_CLAIM, performedBy: "Scheduler (cron)" },
    );
    // No separate claim write, no separate rule-application write.
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
    expect(ruleRepo.recordRuleApplication).not.toHaveBeenCalled();
    expect(postingRepo.recoverRuleEngineJournalLink).not.toHaveBeenCalled();
  });

  it("L1: the posting date passed to the database is exactly the journal date (the run date), never a database clock", async () => {
    await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext(), today: () => "2026-09-16" });
    const call = vi.mocked(postingRepo.postRuleEngineJournalAtomic).mock.calls[0]!;
    expect(call[2].journalDate).toBe("2026-09-16");
    expect(call[4]).toBe("2026-09-16");
    expect(call[2]).toMatchObject({ financialYearLabel: "FY2027", financialPeriod: 7 });
  });

  it("L1: without a test clock the date is today's UTC date, as the old createJournal/postApprovedJournals used", async () => {
    await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    const call = vi.mocked(postingRepo.postRuleEngineJournalAtomic).mock.calls[0]!;
    expect(call[2].journalDate).toBe(TODAY);
    expect(call[4]).toBe(TODAY);
  });

  it("looks the transaction's Banking Rule journal up itself when the caller did not", async () => {
    await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { postingContext: postingContext() });
    expect(journalRepo.listRuleEngineJournalsForTransactions).toHaveBeenCalledWith("co_1", [2151]);
  });

  it("loads the posting context itself when the caller did not", async () => {
    await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null });
    expect(financialYearRepo.listFinancialYears).toHaveBeenCalledWith("co_1");
    expect(postingRepo.postRuleEngineJournalAtomic).toHaveBeenCalledTimes(1);
  });

  it("returns immediately for a transaction that already has a journal", async () => {
    const result = await processTransaction("co_1", freshSalary({ journalId: 12 }), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System");
    expect(result).toMatchObject({ autoPosted: false, journalId: 12 });
    expect(journalRepo.listRuleEngineJournalsForTransactions).not.toHaveBeenCalled();
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
  });
});

describe("processTransaction — classification only (unchanged behaviour, one database call)", () => {
  it("a flag-for-review rule claims the transaction (with every matched rule) and raises the review exception, but never posts", async () => {
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE, FLAG_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toEqual({ transactionId: 2151, matchedRuleIds: [153, 154], autoPosted: false, journalId: null, exceptionsRaised: ["UnbalancedAllocation"] });
    expect(explorerRepo.applyRuleActions).toHaveBeenCalledWith("co_1", 2151, expect.objectContaining({ ruleId: 153, suggestedGlAccount: "6940" }), "Auto: Salaries → GL", "System", [153, 154]);
    expect(exceptionRepo.raiseExceptionIdempotent).toHaveBeenCalledWith("co_1", expect.objectContaining({ exceptionType: "UnbalancedAllocation", reason: "Check payroll first" }));
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
  });

  it("a rule without a GL account claims the transaction and stops", async () => {
    const result = await processTransaction("co_1", freshSalary(), [SUPPLIER_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toEqual({ transactionId: 2151, matchedRuleIds: [155], autoPosted: false, journalId: null, exceptionsRaised: [] });
    expect(explorerRepo.applyRuleActions).toHaveBeenCalledWith("co_1", 2151, expect.objectContaining({ ruleId: 155, matchedSupplierId: 77, allocationStatus: "Allocated" }), "Salaries bureau", "System", [155]);
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
  });

  it("journal lines that cannot be built (bank account without a GL account) still record the classification, as before", async () => {
    const result = await processTransaction("co_1", freshSalary({ bankAccountId: 99 }), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toMatchObject({ autoPosted: false, notPostedReason: expect.any(String), matchedRuleIds: [153] });
    expect(explorerRepo.applyRuleActions).toHaveBeenCalledTimes(1);
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
  });

  it("never records anything when the classification claim lost the race (Phase 25K)", async () => {
    vi.mocked(explorerRepo.applyRuleActions).mockResolvedValue(false);
    const result = await processTransaction("co_1", freshSalary(), [FLAG_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(exceptionRepo.raiseExceptionIdempotent).not.toHaveBeenCalled();
    expect(result).toEqual({ transactionId: 2151, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised: [] });
  });

  it("still raises UnknownMerchant for an unmatched transaction", async () => {
    const result = await processTransaction("co_1", freshSalary({ beneficiary: "Nobody" }), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null });
    expect(result.exceptionsRaised).toEqual(["UnknownMerchant"]);
    expect(exceptionRepo.raiseExceptionIdempotent).toHaveBeenCalledTimes(1);
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
  });

  it("skips re-raising an UnknownMerchant exception the caller knows is already open, but still reports it", async () => {
    const result = await processTransaction("co_1", freshSalary({ beneficiary: "Nobody" }), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, hasOpenUnknownMerchantException: true });
    expect(result.exceptionsRaised).toEqual(["UnknownMerchant"]);
    expect(exceptionRepo.raiseExceptionIdempotent).not.toHaveBeenCalled();
  });

  it("with mayClaim: false a matched claimable transaction is left untouched", async () => {
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE, FLAG_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext(), mayClaim: false });
    expect(result).toEqual({ transactionId: 2151, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised: [] });
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
  });
});

describe("processTransaction — H2. Manual Cashbook entries are never a rule's", () => {
  it("does not claim or post a Manual entry a rule matches", async () => {
    const manual = freshSalary({ entrySource: "Manual", captureStatus: "Submitted" });
    const result = await processTransaction("co_1", manual, [SALARIES_RULE, FLAG_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toEqual({ transactionId: 2151, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised: [] });
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
    expect(exceptionRepo.raiseExceptionIdempotent).not.toHaveBeenCalled();
  });

  it("reports the database's own Manual refusal as not posted (the backstop)", async () => {
    vi.mocked(postingRepo.postRuleEngineJournalAtomic).mockResolvedValue(rpcOutcome({ outcome: "not_eligible", journalId: null, reason: "Manual Cashbook entries are approved and posted from the Cashbook, never by a Banking Rule." }));
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toMatchObject({ autoPosted: false, journalId: null, matchedRuleIds: [], notPostedReason: expect.stringContaining("Manual Cashbook") });
  });
});

describe("processTransaction — B/C/M1. a failed post leaves the transaction unclaimed, so it is retried", () => {
  it("reports an outage as postingError, never as posted — and made no separate claim", async () => {
    vi.mocked(postingRepo.postRuleEngineJournalAtomic).mockRejectedValue(new Error("connection terminated"));
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toMatchObject({ autoPosted: false, journalId: null, postingError: "connection terminated", postingAttempted: true, matchedRuleIds: [] });
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
  });

  it("reports the database's own validation refusal as notPostedReason", async () => {
    vi.mocked(postingRepo.postRuleEngineJournalAtomic).mockRejectedValue({ message: "VYRON_RULE_POST_UNBALANCED: debit 1 <> credit 2." });
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toMatchObject({ autoPosted: false, journalId: null, notPostedReason: expect.stringContaining("VYRON_RULE_POST_UNBALANCED") });
    expect(result.postingError).toBeUndefined();
  });

  it("a closed period creates no journal AND no claim (it used to leave the transaction rule-owned, never retried)", async () => {
    const closed = { ...OPEN_YEAR, status: "Closed" as const };
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext({ financialYears: [closed] }) });
    expect(result).toMatchObject({ autoPosted: false, notPostedReason: expect.stringContaining("closed") });
    expect(result.postingAttempted).toBeUndefined();
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
  });

  it("an account missing from the Chart of Accounts: no database call, no claim", async () => {
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext({ accountCodes: new Set(["1020"]) }) });
    expect(result).toMatchObject({ autoPosted: false, notPostedReason: expect.stringContaining('"6940"') });
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
  });

  it("a posting context that cannot be loaded is an error, with no claim", async () => {
    vi.mocked(financialYearRepo.listFinancialYears).mockRejectedValue(new Error("db down"));
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null });
    expect(result).toMatchObject({ autoPosted: false, postingError: "db down" });
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
  });

  it("reports already_posted / not_eligible outcomes as not posted", async () => {
    vi.mocked(postingRepo.postRuleEngineJournalAtomic).mockResolvedValue(rpcOutcome({ outcome: "not_eligible", journalId: null, reason: "taken over by a person" }));
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toMatchObject({ autoPosted: false, journalId: null, notPostedReason: "taken over by a person" });
  });

  it("M1 end to end: an outage, then a retry that posts exactly once", async () => {
    let down = true;
    const company = installCompany([freshSalary({ id: 1 })], { failPosting: () => (down ? new Error("database unavailable") : null) });

    await expect(runRuleEngine("co_1", "System")).rejects.toThrow("database unavailable");
    const afterFailure = company.store.get(1)!;
    expect(afterFailure).toMatchObject({ journalId: null, postedFlag: false, ruleId: null, allocationStatus: "Unallocated", suggestedGlAccount: null });
    expect(company.journals.size).toBe(0);

    down = false;
    const retry = await runRuleEngine("co_1", "System");
    expect(retry).toMatchObject({ autoPosted: 1, postingErrors: 0 });
    expect(company.store.get(1)).toMatchObject({ postedFlag: true, ruleId: 153, suggestedGlAccount: "6940" });

    const third = await runRuleEngine("co_1", "System");
    expect(third).toMatchObject({ autoPosted: 0, processed: 0 });
    expect(company.postingCalls).toEqual([1, 1]);
    expect(company.journals.size).toBe(1);
  });

  it("M1: a validation refusal is reported, not posted, and the next run tries again rather than giving up silently", async () => {
    let refuse = true;
    const company = installCompany([freshSalary({ id: 1 })], { failPosting: () => (refuse ? Object.assign(new Error("VYRON_RULE_POST_NO_ACCOUNT: 6940"), {}) : null) });
    const first = await runRuleEngine("co_1", "System");
    expect(first).toMatchObject({ autoPosted: 0, notPosted: 1, postingErrors: 0 });
    expect(company.store.get(1)!.ruleId).toBeNull();
    refuse = false;
    const second = await runRuleEngine("co_1", "System");
    expect(second).toMatchObject({ autoPosted: 1, notPosted: 0 });
  });
});

describe("M1 semantics — only the NEW atomic claim + post is retried; LEGACY rule-owned rows wait for a person", () => {
  it("isRuleOwnedAwaitingReview: rule-owned, no journal, not flagged posted", () => {
    expect(isRuleOwnedAwaitingReview(legacyRuleOwned(1))).toBe(true);
    expect(isRuleOwnedAwaitingReview(freshSalary())).toBe(false);
    expect(isRuleOwnedAwaitingReview(legacyRuleOwned(1, { journalId: 9 }))).toBe(false);
    expect(isRuleOwnedAwaitingReview(legacyRuleOwned(1, { postedFlag: true }))).toBe(false);
  });

  it("A/D: a new rule match whose atomic claim + post fails is left unclaimed and retried by the next sweep (posted once)", async () => {
    let down = true;
    const company = installCompany([freshSalary({ id: 1 })], { failPosting: () => (down ? new Error("database unavailable") : null) });
    await expect(runRuleEngine("co_1", "System")).rejects.toThrow("database unavailable");
    expect(isRuleOwnedAwaitingReview(company.store.get(1)!)).toBe(false);
    expect(isClaimableByRule(company.store.get(1)!)).toBe(true);
    down = false;
    expect(await runRuleEngine("co_1", "System")).toMatchObject({ autoPosted: 1, awaitingReview: 0 });
    expect(await runRuleEngine("co_1", "System")).toMatchObject({ autoPosted: 0, processed: 0 });
    expect(company.journals.size).toBe(1);
  });

  it("B/C: 600 legacy rule-owned rows with an active, matching rule and a GL account are never claimed, posted or treated as recoveries — even with budget to spare", async () => {
    const legacy = Array.from({ length: 600 }, (_, i) => legacyRuleOwned(10_000 + i));
    const fresh = [freshSalary({ id: 1, transactionDate: "2026-09-10" }), freshSalary({ id: 2, transactionDate: "2026-01-10" })];
    const company = installCompany([...legacy, ...fresh]);
    const before = legacy.map((t) => JSON.stringify(company.store.get(t.id)));

    for (let run = 0; run < 3; run++) {
      const outcome = await runRuleEngine("co_1", "System", { maxPostings: 1_000, pageSize: 250 });
      expect(outcome).toMatchObject({ awaitingReview: 600, recovered: 0, postingErrors: 0, stoppedEarly: false });
      expect(outcome.autoPosted).toBe(run === 0 ? 2 : 0);
    }

    expect(company.postingCalls.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(company.claimCalls).toEqual([]);
    expect(vi.mocked(postingRepo.recoverRuleEngineJournalLink)).not.toHaveBeenCalled();
    expect(legacy.map((t) => JSON.stringify(company.store.get(t.id)))).toEqual(before);
    expect([...company.journals.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("B: a legacy row is not posted by an explicit Apply Rule selection either", async () => {
    vi.mocked(explorerRepo.getTransactionsByIds).mockResolvedValue([legacyRuleOwned(7)]);
    const [result] = await applyRulesToTransactions("co_1", [7], "user@example.com");
    expect(result).toEqual({ transactionId: 7, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised: [], awaitingReview: true });
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
  });

  it("B: a legacy row whose rule no longer matches keeps its old exception behaviour and is still not posted", async () => {
    const result = await processTransaction("co_1", legacyRuleOwned(8, { beneficiary: "Nobody now" }), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toMatchObject({ autoPosted: false, exceptionsRaised: ["UnknownMerchant"] });
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
  });

  it("classification-only claims made by THIS code (flag for review) are also left for a person, not retried", async () => {
    vi.mocked(ruleRepo.listActiveBankingRules).mockResolvedValue([SALARIES_RULE, FLAG_RULE]);
    const company = installCompany([freshSalary({ id: 1 })]);
    const first = await runRuleEngine("co_1", "System");
    expect(first).toMatchObject({ autoPosted: 0 });
    expect(company.claimCalls).toEqual([1]);
    const second = await runRuleEngine("co_1", "System");
    expect(second).toMatchObject({ autoPosted: 0, awaitingReview: 1 });
    expect(company.postingCalls).toEqual([]);
  });

  it("the 2151 shape (rule-owned WITH a Posted Banking Rule journal) is a separate recovery — linked, never re-posted", async () => {
    const company = installCompany([interruptedSalary({ id: 2151 }), legacyRuleOwned(40)], { journals: new Map([[2151, postedJournal()]]) });
    const outcome = await runRuleEngine("co_1", "System");
    expect(outcome).toMatchObject({ recovered: 1, autoPosted: 0, awaitingReview: 1 });
    expect(company.store.get(2151)).toMatchObject({ journalId: 278, postedFlag: true });
    expect(company.store.get(40)).toMatchObject({ journalId: null, postedFlag: false });
    expect(company.postingCalls).toEqual([]);
  });
});

describe("processTransaction — D/E. existing Posted journal is recovered BEFORE rule matching", () => {
  it("links 2151 to JR000264 even though the claim would refuse it (rule_id already set) — no journal, no batch, no GL", async () => {
    const result = await processTransaction("co_1", interruptedSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "Scheduler (cron)", { ruleEngineJournal: postedJournal(), postingContext: postingContext() });

    expect(result).toEqual({ transactionId: 2151, matchedRuleIds: [], autoPosted: false, journalId: 278, exceptionsRaised: [], recovered: true, postingAttempted: true });
    expect(postingRepo.recoverRuleEngineJournalLink).toHaveBeenCalledWith("co_1", 2151, "Scheduler (cron)");
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
    expect(exceptionRepo.raiseExceptionIdempotent).not.toHaveBeenCalled();
  });

  it("recovers even when no rule matches the transaction any more", async () => {
    const result = await processTransaction("co_1", interruptedSalary(), NO_RULES, BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: postedJournal() });
    expect(result).toMatchObject({ recovered: true, journalId: 278 });
    expect(exceptionRepo.raiseExceptionIdempotent).not.toHaveBeenCalled();
  });

  it("treats an already-linked answer as done, not as a new recovery", async () => {
    vi.mocked(postingRepo.recoverRuleEngineJournalLink).mockResolvedValue(rpcOutcome({ outcome: "already_linked", journalId: 278 }));
    const result = await processTransaction("co_1", interruptedSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: postedJournal() });
    expect(result).toMatchObject({ recovered: false, journalId: 278, autoPosted: false });
  });

  it.each([
    ["Approved (not yet posted)", { status: "Approved" as const }, {}],
    ["reversed", { isReversed: true }, {}],
    ["Posted, but the transaction is flagged posted", {}, { postedFlag: true }],
    ["Posted, but the transaction is reconciled", {}, { reconciliationId: 4 }],
  ])("never posts again and never calls the database when the existing journal is %s", async (_label, journalOverrides, txnOverrides) => {
    const result = await processTransaction("co_1", interruptedSalary(txnOverrides), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: postedJournal(journalOverrides) });
    expect(result).toMatchObject({ autoPosted: false, journalId: null, notPostedReason: expect.stringContaining("JR000264") });
    expect(result.postingAttempted).toBeUndefined();
    expect(postingRepo.recoverRuleEngineJournalLink).not.toHaveBeenCalled();
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
  });

  it("reports a blocked recovery with the database's reason", async () => {
    vi.mocked(postingRepo.recoverRuleEngineJournalLink).mockResolvedValue(rpcOutcome({ outcome: "blocked", journalId: 278, reason: "ledger entries are incomplete" }));
    const result = await processTransaction("co_1", interruptedSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: postedJournal() });
    expect(result).toMatchObject({ journalId: null, notPostedReason: "ledger entries are incomplete" });
  });

  it("reports a failed recovery call as a postingError", async () => {
    vi.mocked(postingRepo.recoverRuleEngineJournalLink).mockRejectedValue(new Error("timeout"));
    const result = await processTransaction("co_1", interruptedSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: postedJournal() });
    expect(result).toMatchObject({ journalId: null, postingError: "timeout" });
  });

  it("does nothing (and makes no write) for a rule-owned transaction with NO journal — a person posts those", async () => {
    const result = await processTransaction("co_1", interruptedSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null });
    expect(result).toEqual({ transactionId: 2151, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised: [], awaitingReview: true });
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
  });
});

describe("processTransaction — F. a concurrent worker won the race", () => {
  it("reports the transaction as linked when the atomic call finds the other worker's journal", async () => {
    vi.mocked(postingRepo.postRuleEngineJournalAtomic).mockResolvedValue(rpcOutcome({ outcome: "already_linked", journalId: 901 }));
    const result = await processTransaction("co_1", freshSalary(), [SALARIES_RULE], BANK_ACCOUNTS_BY_ID, "System", { ruleEngineJournal: null, postingContext: postingContext() });
    expect(result).toMatchObject({ autoPosted: false, journalId: 901, recovered: false, matchedRuleIds: [] });
  });
});

describe("runRuleEngine — H1. no starvation (the Northwood shape)", () => {
  it("posts matched transactions that sit behind more than 150 unmatched claimable ones, in the same run", async () => {
    // 200 newer unmatched claimable rows, then 5 older matched ones.
    const unmatchedRows = Array.from({ length: 200 }, (_, i) => unmatched(1000 + i, { transactionDate: "2026-09-01" }));
    const matchedRows = Array.from({ length: 5 }, (_, i) => freshSalary({ id: 10 + i, transactionDate: "2026-03-01" }));
    const company = installCompany([...unmatchedRows, ...matchedRows]);

    const outcome = await runRuleEngine("co_1", "System", { maxPostings: 150 });

    expect(outcome).toMatchObject({ autoPosted: 5, postingAttempts: 5, stoppedEarly: false, stopReason: null, remaining: 0, intelligenceSkipped: false });
    expect(company.postingCalls.sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14]);
    // Unmatched rows never reached the posting call, but every one was evaluated (exceptions).
    expect(company.openUnknown.size).toBe(200);
    expect(outcome.processed).toBe(205);
  });

  it("unmatched claimable rows never consume the posting budget, even with a budget of 1", async () => {
    const company = installCompany([...Array.from({ length: 300 }, (_, i) => unmatched(1000 + i)), freshSalary({ id: 5, transactionDate: "2020-01-01" })]);
    const outcome = await runRuleEngine("co_1", "System", { maxPostings: 1 });
    expect(outcome).toMatchObject({ autoPosted: 1, postingAttempts: 1, stopReason: null });
    expect(company.postingCalls).toEqual([5]);
  });

  it("stops posting at the limit, still refreshes exceptions for the rest, and continues next run without re-posting", async () => {
    const matchedRows = Array.from({ length: 7 }, (_, i) => freshSalary({ id: 100 + i }));
    const company = installCompany([...matchedRows, unmatched(900)]);

    const first = await runRuleEngine("co_1", "System", { maxPostings: 3 });
    expect(first).toMatchObject({ autoPosted: 3, postingAttempts: 3, stoppedEarly: true, stopReason: "posting-limit", remaining: 4 });
    expect(company.openUnknown.has(900)).toBe(true);
    // The unposted matched rows were seen by the unbudgeted pass but never claimed.
    expect(company.claimCalls).toEqual([]);
    expect([...company.store.values()].filter((t) => t.ruleId !== null)).toHaveLength(3);

    const second = await runRuleEngine("co_1", "System", { maxPostings: 3 });
    const third = await runRuleEngine("co_1", "System", { maxPostings: 3 });
    expect(second).toMatchObject({ autoPosted: 3, stopReason: "posting-limit" });
    expect(third).toMatchObject({ autoPosted: 1, stopReason: null, stoppedEarly: false, remaining: 0 });
    expect(new Set(company.postingCalls).size).toBe(company.postingCalls.length);
    expect(company.journals.size).toBe(7);
  });

  it("orders recoveries, then matched claimable rows, then the rest — and posts nothing twice", async () => {
    const other = txn({ id: 10, beneficiary: "Somebody", transactionDate: "2026-09-10" }); // matched supplier: not claimable
    const flagged = freshSalary({ id: 11, transactionDate: "2026-09-09", beneficiary: "Salaries" });
    const noMatch = unmatched(12, { transactionDate: "2026-09-08" });
    const fresh = freshSalary({ id: 20, transactionDate: "2026-03-01" });
    const interrupted = interruptedSalary({ id: 30, transactionDate: "2026-02-01" });
    const legacyOwned = interruptedSalary({ id: 40, transactionDate: "2026-01-01" }); // rule-owned, no journal: waits for a person
    const company = installCompany([other, flagged, noMatch, fresh, interrupted, legacyOwned], { journals: new Map([[30, postedJournal({ id: 278, sourceId: 30 })]]) });
    vi.mocked(ruleRepo.listActiveBankingRules).mockResolvedValue([SALARIES_RULE]);

    const outcome = await runRuleEngine("co_1", "System");

    expect(outcome.results.map((r) => r.transactionId)).toEqual([30, 11, 20, 10, 12, 40]);
    expect(outcome).toMatchObject({ processed: 6, autoPosted: 2, recovered: 1, postingAttempts: 3, remaining: 0, stoppedEarly: false, stopReason: null, intelligenceSkipped: false });
    expect(company.postingCalls.sort((a, b) => a - b)).toEqual([11, 20]);
    expect(company.store.get(30)).toMatchObject({ journalId: 278, postedFlag: true });
    expect(company.store.get(40)).toMatchObject({ journalId: null, postedFlag: false }); // unchanged
    expect(company.store.get(10)).toMatchObject({ journalId: null, ruleId: null }); // unchanged
    expect(company.openUnknown).toEqual(new Set([12]));
  });

  it("a mixture with a flag rule: the flagged row is classified once and never posted; the others post", async () => {
    vi.mocked(ruleRepo.listActiveBankingRules).mockResolvedValue([SALARIES_RULE, { ...FLAG_RULE, conditions: [condition({ field: "description", operator: "contains", value: "CHECK" })] }]);
    const company = installCompany([
      freshSalary({ id: 1, description: "Salaries CHECK" }),
      freshSalary({ id: 2 }),
      unmatched(3),
      freshSalary({ id: 4, entrySource: "Manual", captureStatus: "Draft" }),
    ]);

    const outcome = await runRuleEngine("co_1", "System");

    expect(company.postingCalls.sort()).toEqual([2]);
    expect(company.claimCalls).toEqual([1]);
    expect(company.store.get(1)).toMatchObject({ ruleId: 153, journalId: null });
    expect(company.store.get(4)).toMatchObject({ ruleId: null, journalId: null, postedFlag: false }); // Manual: untouched
    expect(outcome).toMatchObject({ autoPosted: 1, exceptionsRaised: 2 });
    const ruleExceptions = vi.mocked(exceptionRepo.raiseExceptionIdempotent).mock.calls.filter((c) => c[1].exceptionType !== "PossibleDuplicate");
    expect(ruleExceptions.map((c) => [c[1].bankTransactionId, c[1].exceptionType])).toEqual([
      [1, "UnbalancedAllocation"],
      [3, "UnknownMerchant"],
    ]);
  });

  it("an existing open UnknownMerchant exception is not inserted again", async () => {
    const company = installCompany([unmatched(1), unmatched(2)]);
    company.openUnknown.add(1);
    await runRuleEngine("co_1", "System");
    expect(vi.mocked(exceptionRepo.raiseExceptionIdempotent).mock.calls.map((c) => c[1].bankTransactionId)).toEqual([2]);
  });
});

describe("runRuleEngine — M2. the whole worklist is reachable (more than 1,000 rows)", () => {
  it("pages through 2,600 unposted rows, never asks for more than 1,000 at once, and posts the oldest matched one", async () => {
    const rows = [
      ...Array.from({ length: 2_599 }, (_, i) => unmatched(10_000 + i, { transactionDate: `2026-${String(1 + (i % 9)).padStart(2, "0")}-15` })),
      freshSalary({ id: 7, transactionDate: "2019-01-01" }), // the very tail
    ];
    const company = installCompany(rows);

    const outcome = await runRuleEngine("co_1", "System", { pageSize: 1000 });

    expect(company.pageRequests.every((r) => r.limit <= 1000)).toBe(true);
    expect(company.pageRequests.filter((r) => !r.claimableOnly).length).toBeGreaterThanOrEqual(3);
    expect(company.postingCalls).toEqual([7]);
    expect(outcome).toMatchObject({ autoPosted: 1, processed: 2_600, remaining: 0, stoppedEarly: false });
    expect(company.openUnknown.size).toBe(2_599);
  });

  it("reaches a recovery (the 2151 shape) behind more than 1,000 other unposted rows", async () => {
    const rows = [...Array.from({ length: 1_500 }, (_, i) => unmatched(10_000 + i, { transactionDate: "2026-09-01" })), interruptedSalary({ id: 2151, transactionDate: "2026-03-27" })];
    const company = installCompany(rows, { journals: new Map([[2151, postedJournal()]]) });
    const outcome = await runRuleEngine("co_1", "System");
    expect(outcome.results[0]).toMatchObject({ transactionId: 2151, recovered: true, journalId: 278 });
    expect(company.store.get(2151)).toMatchObject({ journalId: 278, postedFlag: true });
    expect(company.postingCalls).toEqual([]);
  });

  it("keeps the page order stable while rows are posted mid-run (keyset, not offset)", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => freshSalary({ id: 100 + i, transactionDate: i % 2 ? null as unknown as string : "2026-05-01" }));
    const company = installCompany(rows);
    const outcome = await runRuleEngine("co_1", "System", { pageSize: 4 });
    expect(outcome.autoPosted).toBe(25);
    expect([...company.postingCalls].sort((a, b) => a - b)).toEqual(rows.map((r) => r.id));
    // Rows without a date come first (DESC NULLS FIRST), then by id, newest first.
    expect(company.postingCalls.slice(0, 3)).toEqual([123, 121, 119]);
  });
});

describe("runRuleEngine — time budget and failures", () => {
  it("stops starting work at its deadline, reports what is left, and skips the intelligence pass", async () => {
    installCompany(Array.from({ length: 10 }, (_, i) => freshSalary({ id: 100 + i })));
    const now = clock(1_000);
    const outcome = await runRuleEngine("co_1", "System", { now, deadlineAtMs: 1_000_000 + 6_500 });
    expect(outcome.processed).toBeGreaterThan(0);
    expect(outcome.processed).toBeLessThan(10);
    expect(outcome).toMatchObject({ stoppedEarly: true, stopReason: "time-budget", intelligenceSkipped: true, remaining: 10 - outcome.processed });
    expect(postingRepo.postRuleEngineJournalAtomic).toHaveBeenCalledTimes(outcome.processed);
  });

  it("an already-expired deadline starts nothing", async () => {
    const company = installCompany([freshSalary({ id: 1 })]);
    const outcome = await runRuleEngine("co_1", "System", { now: () => 5, deadlineAtMs: 1 });
    expect(outcome).toMatchObject({ processed: 0, stoppedEarly: true, stopReason: "time-budget", remaining: 1 });
    expect(company.pageRequests).toEqual([]);
  });

  it("throws (so the scheduler retries/suspends) only when every attempted posting failed outright", async () => {
    installCompany([freshSalary({ id: 1 }), freshSalary({ id: 2 })], { failPosting: () => new Error("database unavailable") });
    await expect(runRuleEngine("co_1", "System")).rejects.toThrow("database unavailable");
  });

  it("does not throw when some postings succeeded", async () => {
    installCompany([freshSalary({ id: 1, transactionDate: "2026-05-02" }), freshSalary({ id: 2, transactionDate: "2026-05-01" })], { failPosting: (id) => (id === 2 ? new Error("blip") : null) });
    const outcome = await runRuleEngine("co_1", "System");
    expect(outcome).toMatchObject({ autoPosted: 1, postingErrors: 1 });
  });

  it("does not throw for validation refusals (a data problem, not an outage)", async () => {
    installCompany([freshSalary({ id: 1 })], { failPosting: () => new Error("VYRON_RULE_POST_NO_ACCOUNT: 6940") });
    const outcome = await runRuleEngine("co_1", "System");
    expect(outcome).toMatchObject({ autoPosted: 0, notPosted: 1, postingErrors: 0 });
  });

  it("the default posting limit is still 150", () => {
    expect(DEFAULT_RULE_ENGINE_MAX_POSTINGS).toBe(150);
  });
});

describe("applyRulesToTransactions — shares the same prepared context", () => {
  it("looks journals up once for the whole selection and recovers or posts each", async () => {
    vi.mocked(explorerRepo.getTransactionsByIds).mockResolvedValue([freshSalary({ id: 1 }), interruptedSalary({ id: 2 })]);
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockResolvedValue(new Map([[2, postedJournal({ sourceId: 2 })]]));

    const results = await applyRulesToTransactions("co_1", [1, 2], "user@example.com");

    expect(journalRepo.listRuleEngineJournalsForTransactions).toHaveBeenCalledTimes(1);
    expect(results.map((r) => ({ id: r.transactionId, autoPosted: r.autoPosted, recovered: r.recovered ?? false }))).toEqual([
      { id: 1, autoPosted: true, recovered: false },
      { id: 2, autoPosted: false, recovered: true },
    ]);
    expect(vi.mocked(postingRepo.postRuleEngineJournalAtomic).mock.calls[0]![5]).toMatchObject({ performedBy: "user@example.com", ruleId: 153 });
  });

  it("never posts a Manual Cashbook entry from an explicit selection either", async () => {
    vi.mocked(explorerRepo.getTransactionsByIds).mockResolvedValue([freshSalary({ id: 1, entrySource: "Manual", captureStatus: "Draft" })]);
    const results = await applyRulesToTransactions("co_1", [1], "user@example.com");
    expect(results).toEqual([{ transactionId: 1, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised: [] }]);
    expect(postingRepo.postRuleEngineJournalAtomic).not.toHaveBeenCalled();
    expect(explorerRepo.applyRuleActions).not.toHaveBeenCalled();
  });
});
