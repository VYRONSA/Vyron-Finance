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
  LIST_CAP: 10_000,
}));
vi.mock("@/server/repositories/bank-account-repository", () => ({ getBankAccount: vi.fn() }));
vi.mock("@/server/repositories/journal-repository", () => ({ createJournal: vi.fn() }));
vi.mock("@/server/services/chart-of-accounts-service", () => ({ listChartOfAccounts: vi.fn() }));
vi.mock("@/server/services/journal-service", () => ({ resolveBankGlAccount: vi.fn((bankAccount: { glAccount: string }) => bankAccount.glAccount) }));
vi.mock("@/server/services/posting-rule-service", () => ({ buildJournalFromEvent: vi.fn() }));
vi.mock("@/server/services/posting-engine-service", () => ({ postApprovedJournals: vi.fn() }));
vi.mock("@/server/services/bank-reconciliation-service", () => ({ assertNotMonthEndLocked: vi.fn() }));

import { approveAndPostCashbookEntry, ValidationError } from "./cashbook-service";
import * as repo from "@/server/repositories/cashbook-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import type { BankTransactionRecord } from "@/server/accounting/types";

function txn(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: 501, companyId: "co_1", transactionDate: "2026-08-01", reference: "CB-1", description: "Office Rent", beneficiary: "Landlord Co",
    debit: 5000, credit: 0, balance: null, bankAccount: "Main Account", bankAccountId: 1, glAccount: "6100", vat: 0, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-08-01T00:00:00.000Z", allocationStatus: "Unallocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Manual", captureStatus: "Submitted", cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1, reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null,
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
