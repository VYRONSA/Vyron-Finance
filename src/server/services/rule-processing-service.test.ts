import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/transaction-explorer-repository", () => ({ applyRuleActions: vi.fn(), markTransactionPosted: vi.fn() }));
vi.mock("@/server/repositories/banking-rule-repository", () => ({ recordRuleApplication: vi.fn(), listActiveBankingRules: vi.fn(), getBankingRule: vi.fn() }));
vi.mock("@/server/repositories/banking-exception-repository", () => ({ raiseExceptionIdempotent: vi.fn() }));
vi.mock("@/server/repositories/merchant-repository", () => ({}));
vi.mock("@/server/repositories/bank-account-repository", () => ({ getBankAccount: vi.fn() }));
vi.mock("@/server/repositories/journal-repository", () => ({ createJournal: vi.fn(), getJournalBySource: vi.fn() }));
vi.mock("@/server/services/posting-engine-service", () => ({ postApprovedJournals: vi.fn() }));

import { toEvaluable, processTransaction } from "./rule-processing-service";
import { matchesCondition } from "@/server/banking-rules/rule-engine";
import * as explorerRepo from "@/server/repositories/transaction-explorer-repository";
import * as ruleRepo from "@/server/repositories/banking-rule-repository";
import * as exceptionRepo from "@/server/repositories/banking-exception-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { BankingRuleCondition, BankingRule } from "@/server/banking-rules/types";
import type { Journal } from "@/server/accounting/types";

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

function condition(overrides: Partial<BankingRuleCondition> = {}): BankingRuleCondition {
  return { id: 1, field: "beneficiary", operator: "equals", value: "", value2: null, ...overrides };
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

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    id: 900, companyId: "co_1", journalNumber: "JR000900", journalDate: "2026-07-01", journalType: "Bank Transaction Automation",
    description: "", reference: "REF-1", sourceType: "bank_transaction_rule_engine", sourceId: 1, status: "Posted",
    totalDebit: 500, totalCredit: 500, createdAt: "2026-07-01T00:00:00Z", postedAt: "2026-07-01T00:00:01Z",
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null,
    ...overrides,
  } as Journal;
}

const BANK_ACCOUNTS_BY_ID = new Map([[1, { glAccount: "1000", accountNumber: "MAIN-001" }]]);
const NO_RULES: BankingRule[] = [];

describe("processTransaction — duplicate-journal-on-retry guard (Phase 25I)", () => {
  beforeEach(() => {
    vi.mocked(explorerRepo.applyRuleActions).mockReset().mockResolvedValue(true);
    vi.mocked(explorerRepo.markTransactionPosted).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(ruleRepo.recordRuleApplication).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(exceptionRepo.raiseExceptionIdempotent).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(journalRepo.createJournal).mockReset();
    vi.mocked(journalRepo.getJournalBySource).mockReset().mockResolvedValue(null);
    vi.mocked(postApprovedJournals).mockReset();
  });

  it("creates and posts a journal normally when no journal already exists for this transaction (baseline, unchanged behavior)", async () => {
    vi.mocked(journalRepo.createJournal).mockResolvedValue(journal({ status: "Approved" }));
    vi.mocked(postApprovedJournals).mockResolvedValue({ batch: null, posted: [{ journalId: 900, journalNumber: "JR000900" }], skipped: [] });

    const result = await processTransaction("co_1", txn(), NO_RULES, BANK_ACCOUNTS_BY_ID, "System");

    expect(journalRepo.getJournalBySource).toHaveBeenCalledWith("co_1", "bank_transaction_rule_engine", 1);
    expect(journalRepo.createJournal).toHaveBeenCalledTimes(1);
    expect(explorerRepo.markTransactionPosted).toHaveBeenCalledWith("co_1", 1, 900);
    expect(result).toMatchObject({ autoPosted: true, journalId: 900 });
  });

  it("does NOT create a second journal when one already exists for this transaction, and backfills markTransactionPosted if it's already Posted (the core fix)", async () => {
    vi.mocked(journalRepo.getJournalBySource).mockResolvedValue(journal({ id: 901, status: "Posted" }));

    const result = await processTransaction("co_1", txn(), NO_RULES, BANK_ACCOUNTS_BY_ID, "System");

    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(postApprovedJournals).not.toHaveBeenCalled();
    expect(explorerRepo.markTransactionPosted).toHaveBeenCalledWith("co_1", 1, 901);
    expect(result).toMatchObject({ autoPosted: true, journalId: 901 });
  });

  it("does NOT create a second journal or backfill the posted stamp when the existing journal isn't Posted yet (still Draft/Approved)", async () => {
    vi.mocked(journalRepo.getJournalBySource).mockResolvedValue(journal({ id: 902, status: "Approved" }));

    const result = await processTransaction("co_1", txn(), NO_RULES, BANK_ACCOUNTS_BY_ID, "System");

    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(explorerRepo.markTransactionPosted).not.toHaveBeenCalled();
    expect(result).toMatchObject({ autoPosted: false, journalId: null });
  });
});

describe("processTransaction — applyRuleActions posted/manual-override race guard (Phase 25K)", () => {
  beforeEach(() => {
    vi.mocked(explorerRepo.markTransactionPosted).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(ruleRepo.recordRuleApplication).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(exceptionRepo.raiseExceptionIdempotent).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(journalRepo.createJournal).mockReset();
    vi.mocked(journalRepo.getJournalBySource).mockReset().mockResolvedValue(null);
    vi.mocked(postApprovedJournals).mockReset();
  });

  it("never records a rule application or creates a journal when applyRuleActions reports it lost the race (posted or manually recoded by another process)", async () => {
    vi.mocked(explorerRepo.applyRuleActions).mockResolvedValue(false);

    const result = await processTransaction("co_1", txn(), NO_RULES, BANK_ACCOUNTS_BY_ID, "System");

    expect(ruleRepo.recordRuleApplication).not.toHaveBeenCalled();
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(result).toEqual({ transactionId: 1, matchedRuleIds: [], autoPosted: false, journalId: null, exceptionsRaised: [] });
  });

  it("proceeds normally (records applications, creates the journal) when applyRuleActions succeeds", async () => {
    vi.mocked(explorerRepo.applyRuleActions).mockResolvedValue(true);
    vi.mocked(journalRepo.createJournal).mockResolvedValue(journal({ status: "Approved" }));
    vi.mocked(postApprovedJournals).mockResolvedValue({ batch: null, posted: [{ journalId: 900, journalNumber: "JR000900" }], skipped: [] });

    const result = await processTransaction("co_1", txn(), NO_RULES, BANK_ACCOUNTS_BY_ID, "System");

    expect(journalRepo.createJournal).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ autoPosted: true, journalId: 900 });
  });
});
