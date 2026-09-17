/**
 * Phase 29C — forensic audit finding: `approveAndPostCashbookEntry`/
 * `approveAndPostTransfer` only ever guarded double-posting with an
 * app-level "read captureStatus, then write" check, with a real journal
 * -creation sequence running in the window between the two. Two
 * concurrent "Approve and Post" requests on the same entry could both
 * pass the initial check and both successfully post — two journals for
 * one Cashbook entry. Fixed by making the final `journal_id`-attaching
 * write atomically guarded (`repo.postCaptureStatus`, mirroring
 * `journal-repository.ts::linkTransactionToJournal`'s established
 * `.is("journal_id", null)` pattern) — these tests prove the service
 * layer correctly surfaces a lost race as a clear `ValidationError`
 * rather than a silent double-post.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/cashbook-repository", () => ({
  getCashbookTransaction: vi.fn(),
  listCashbookTransactions: vi.fn(),
  listCashbookBatches: vi.fn(),
  listBatchTransactions: vi.fn(),
  postCaptureStatus: vi.fn(),
  setCaptureStatus: vi.fn(),
  createManualTransaction: vi.fn(),
  getCashbookBatch: vi.fn(),
  setBatchStatus: vi.fn(),
  LIST_CAP: 10_000,
}));
vi.mock("@/server/repositories/bank-account-repository", () => ({ getBankAccount: vi.fn() }));
vi.mock("@/server/repositories/journal-repository", () => ({ createJournal: vi.fn(), listRuleEngineJournalsForTransactions: vi.fn() }));
vi.mock("@/server/services/chart-of-accounts-service", () => ({ listChartOfAccounts: vi.fn() }));
vi.mock("@/server/services/journal-service", () => ({ resolveBankGlAccount: vi.fn((bankAccount: { glAccount: string }) => bankAccount.glAccount) }));
vi.mock("@/server/services/posting-rule-service", () => ({ buildJournalFromEvent: vi.fn() }));
vi.mock("@/server/services/posting-engine-service", () => ({ postApprovedJournals: vi.fn() }));
vi.mock("@/server/services/bank-reconciliation-service", () => ({ assertNotMonthEndLocked: vi.fn() }));

import { approveAndPostBatch, approveAndPostCashbookEntry, reverseCashbookEntry, ValidationError } from "./cashbook-service";
import * as repo from "@/server/repositories/cashbook-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import type { BankTransactionRecord, RuleEngineJournalRef } from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 501, companyId: "co_1", transactionDate: "2026-08-01", reference: "CB-1", description: "Office Rent", beneficiary: "Landlord Co",
    debit: 5000, credit: 0, balance: null, bankAccount: "Main Account", bankAccountId: 1, glAccount: "6100", vat: 0, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Unallocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Manual", captureStatus: "Submitted", cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(repo.getCashbookTransaction).mockReset().mockResolvedValue(txn());
  vi.mocked(repo.listCashbookTransactions).mockReset().mockResolvedValue([]);
  vi.mocked(repo.postCaptureStatus).mockReset().mockResolvedValue(txn({ captureStatus: "Posted", journalId: 900 }));
  vi.mocked(bankAccountRepo.getBankAccount).mockReset().mockResolvedValue({ id: 1, companyId: "co_1", glAccount: "1000", accountNumber: "MAIN-001", accountName: "Main Account" } as never);
  vi.mocked(listChartOfAccounts).mockReset().mockResolvedValue([{ accountCode: "1000" }, { accountCode: "6100" }] as never);
  vi.mocked(buildJournalFromEvent).mockReset().mockResolvedValue({ ok: true, lines: [] } as never);
  vi.mocked(journalRepo.createJournal).mockReset().mockResolvedValue({ id: 900 } as never);
  vi.mocked(postApprovedJournals).mockReset().mockResolvedValue({ posted: [{ journalId: 900 }], skipped: [] } as never);
  vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockReset().mockResolvedValue(new Map());
});

describe("approveAndPostCashbookEntry — posting race guard (Phase 29C)", () => {
  it("posts normally when nothing races it (baseline, unchanged behavior)", async () => {
    const result = await approveAndPostCashbookEntry("co_1", 501);
    expect(repo.postCaptureStatus).toHaveBeenCalledWith("co_1", 501, 900);
    expect(result.captureStatus).toBe("Posted");
  });

  it("throws a clear ValidationError instead of silently double-posting when a concurrent request already posted this entry", async () => {
    vi.mocked(repo.postCaptureStatus).mockResolvedValue(null); // the atomic guard lost the race

    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow(ValidationError);
    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow(/already posted/);
  });

  it("a real journal was still created and posted before the race guard is even checked — the guard is the LAST step, not a substitute for the app-level pre-check", async () => {
    vi.mocked(repo.postCaptureStatus).mockResolvedValue(null);
    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow(ValidationError);
    expect(journalRepo.createJournal).toHaveBeenCalled();
    expect(postApprovedJournals).toHaveBeenCalled();
  });

  it("still rejects an already-Posted entry at the app-level pre-check, before any journal work happens", async () => {
    vi.mocked(repo.getCashbookTransaction).mockResolvedValue(txn({ captureStatus: "Posted" }));
    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow("This entry is already Posted.");
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
  });
});

describe("approveAndPostTransfer — posting race guard (Phase 29C)", () => {
  const fromLeg = txn({ id: 501, reference: "TRANSFER-1", debit: 2000, credit: 0, bankAccountId: 1 });
  const toLeg = txn({ id: 502, reference: "TRANSFER-1", debit: 0, credit: 2000, bankAccountId: 2 });

  beforeEach(() => {
    vi.mocked(repo.getCashbookTransaction).mockResolvedValue(fromLeg);
    vi.mocked(repo.listCashbookTransactions).mockResolvedValue([toLeg]);
    vi.mocked(bankAccountRepo.getBankAccount).mockImplementation(async (_companyId, id) =>
      ({ id, companyId: "co_1", glAccount: id === 1 ? "1000" : "1010", accountNumber: `ACC-${id}`, accountName: `Account ${id}` }) as never,
    );
    vi.mocked(listChartOfAccounts).mockResolvedValue([{ accountCode: "1000" }, { accountCode: "1010" }] as never);
  });

  it("posts both legs normally when nothing races it", async () => {
    const result = await approveAndPostCashbookEntry("co_1", 501);
    expect(repo.postCaptureStatus).toHaveBeenCalledWith("co_1", 502, 900);
    expect(repo.postCaptureStatus).toHaveBeenCalledWith("co_1", 501, 900);
    expect(result.captureStatus).toBe("Posted");
  });

  it("throws when the OTHER leg loses the race, without leaving this leg silently posted alone", async () => {
    vi.mocked(repo.postCaptureStatus).mockImplementation(async (_companyId, id) => (id === 502 ? null : txn({ id, captureStatus: "Posted", journalId: 900 })));
    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow(/other leg was already posted/);
  });

  it("throws when THIS leg loses the race after the other leg already succeeded", async () => {
    vi.mocked(repo.postCaptureStatus).mockImplementation(async (_companyId, id) => (id === 501 ? null : txn({ id, captureStatus: "Posted", journalId: 900 })));
    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow(ValidationError);
  });
});

function ruleJournal(overrides: Partial<RuleEngineJournalRef> = {}): RuleEngineJournalRef {
  return { id: 278, journalNumber: "JR000264", status: "Posted", isReversed: false, sourceId: 501, ...overrides };
}

describe("approveAndPostCashbookEntry — refused BEFORE anything is written (0100 review H2)", () => {
  function expectNothingWritten() {
    expect(buildJournalFromEvent).not.toHaveBeenCalled();
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(postApprovedJournals).not.toHaveBeenCalled();
    expect(repo.postCaptureStatus).not.toHaveBeenCalled();
  }

  it.each([
    ["Posted", ruleJournal()],
    ["Approved", ruleJournal({ status: "Approved" })],
    ["Draft", ruleJournal({ status: "Draft" })],
    ["Submitted", ruleJournal({ status: "Submitted" })],
  ])("refuses an entry a %s Banking Rule journal already carries", async (_label, journal) => {
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockResolvedValue(new Map([[501, journal]]));
    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow(/already carried by Banking Rule journal JR000264/);
    expect(journalRepo.listRuleEngineJournalsForTransactions).toHaveBeenCalledWith("co_1", [501]);
    expectNothingWritten();
  });

  it("refuses an entry that is already linked to a journal, without even looking further", async () => {
    vi.mocked(repo.getCashbookTransaction).mockResolvedValue(txn({ journalId: 77 }));
    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow(/already linked to a journal/);
    expectNothingWritten();
  });

  it("refuses an entry already flagged as posted", async () => {
    vi.mocked(repo.getCashbookTransaction).mockResolvedValue(txn({ postedFlag: true }));
    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow(/already flagged as posted/);
    expectNothingWritten();
  });

  it("still posts when the only Banking Rule journal was reversed (its ledger effect was cancelled) or rejected", async () => {
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockResolvedValue(new Map([[501, ruleJournal({ isReversed: true })]]));
    await expect(approveAndPostCashbookEntry("co_1", 501)).resolves.toMatchObject({ captureStatus: "Posted" });
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockResolvedValue(new Map([[501, ruleJournal({ status: "Rejected" })]]));
    await expect(approveAndPostCashbookEntry("co_1", 501)).resolves.toMatchObject({ captureStatus: "Posted" });
  });

  it("an ordinary receipt and payment post exactly as before (one journal, one post, one link)", async () => {
    vi.mocked(repo.getCashbookTransaction).mockResolvedValueOnce(txn({ debit: 0, credit: 750 }));
    await approveAndPostCashbookEntry("co_1", 501);
    expect(buildJournalFromEvent).toHaveBeenLastCalledWith("co_1", "Cashbook Receipt", expect.objectContaining({ grossAmount: 750 }));
    await approveAndPostCashbookEntry("co_1", 501);
    expect(buildJournalFromEvent).toHaveBeenLastCalledWith("co_1", "Cashbook Payment", expect.objectContaining({ grossAmount: 5000 }));
    expect(journalRepo.createJournal).toHaveBeenCalledTimes(2);
    expect(journalRepo.createJournal).toHaveBeenLastCalledWith("co_1", expect.objectContaining({ sourceType: "cashbook_entry", sourceId: 501, status: "Approved" }));
    expect(postApprovedJournals).toHaveBeenCalledTimes(2);
    expect(repo.postCaptureStatus).toHaveBeenCalledTimes(2);
  });

  it("a transfer is refused when EITHER leg is already carried", async () => {
    const fromLeg = txn({ id: 501, reference: "TRANSFER-1", debit: 2000, credit: 0, bankAccountId: 1 });
    const toLeg = txn({ id: 502, reference: "TRANSFER-1", debit: 0, credit: 2000, bankAccountId: 2 });
    vi.mocked(repo.getCashbookTransaction).mockResolvedValue(fromLeg);
    vi.mocked(repo.listCashbookTransactions).mockResolvedValue([toLeg]);
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockResolvedValue(new Map([[502, ruleJournal({ sourceId: 502 })]]));
    await expect(approveAndPostCashbookEntry("co_1", 501)).rejects.toThrow(/#502 is already carried/);
    expect(journalRepo.listRuleEngineJournalsForTransactions).toHaveBeenCalledWith("co_1", [501, 502]);
    expectNothingWritten();
  });

  it("a reversal (a brand-new Manual entry) is not affected", async () => {
    const original = txn({ id: 600, captureStatus: "Posted", journalId: 900 });
    const reversal = txn({ id: 601, debit: 0, credit: 5000, reference: "REV-CB-1" });
    vi.mocked(repo.getCashbookTransaction).mockImplementation(async (_co, id) => (id === 600 ? original : reversal));
    vi.mocked(repo.createManualTransaction).mockResolvedValue(reversal);
    await expect(reverseCashbookEntry("co_1", 600)).resolves.toMatchObject({ captureStatus: "Posted" });
    expect(journalRepo.listRuleEngineJournalsForTransactions).toHaveBeenCalledWith("co_1", [601]);
  });

  it("a batch stops at the first carried entry instead of posting it twice", async () => {
    const entries = [txn({ id: 1 }), txn({ id: 2 })];
    vi.mocked(repo.getCashbookBatch).mockResolvedValue({ id: 9, batchNumber: "CB9", status: "Draft" } as never);
    vi.mocked(repo.listBatchTransactions).mockResolvedValue(entries);
    vi.mocked(repo.getCashbookTransaction).mockImplementation(async (_co, id) => entries.find((e) => e.id === id)!);
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockImplementation(async (_co, ids) => new Map(ids.includes(2) ? [[2, ruleJournal({ sourceId: 2 })]] : []));
    await expect(approveAndPostBatch("co_1", 9)).rejects.toThrow(/#2 is already carried/);
    expect(postApprovedJournals).toHaveBeenCalledTimes(1);
  });
});
