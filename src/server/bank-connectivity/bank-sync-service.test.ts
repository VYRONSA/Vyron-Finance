import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/bank-connectivity-repository", () => ({
  startBankSyncRun: vi.fn(),
  finishBankSyncRun: vi.fn(),
  recordSuccessfulSyncCursor: vi.fn(),
  recordFailedSync: vi.fn(),
  listConnectedBankConnections: vi.fn(),
  listBankConnectionAccounts: vi.fn(),
}));
vi.mock("@/server/repositories/import-repository", () => ({ ingestBankTransactionIdempotent: vi.fn() }));
vi.mock("@/server/repositories/bank-account-repository", () => ({ getBankAccount: vi.fn() }));
vi.mock("@/server/services/rule-processing-service", () => ({ applyRulesToTransactions: vi.fn().mockResolvedValue([]) }));
vi.mock("@/server/billing-platform/engine/usage-metering-engine", () => ({ recordUsageEvent: vi.fn() }));
vi.mock("@/server/services/transaction-classification-service", () => ({ classifyUnallocatedTransactionsWithAi: vi.fn().mockResolvedValue({ classified: 0, skipped: 0, failed: 0 }) }));
vi.mock("./bank-connectivity-service", () => ({ getAuthorizedSession: vi.fn().mockResolvedValue({ accessToken: "the-access-token" }) }));
vi.mock("./providers/fnb/fnb-provider", () => ({ createFnbProvider: vi.fn() }));

import { syncAllConnectedAccounts, syncBankConnectionAccount } from "./bank-sync-service";
import * as connectivityRepo from "@/server/repositories/bank-connectivity-repository";
import * as importRepo from "@/server/repositories/import-repository";
import { getBankAccount } from "@/server/repositories/bank-account-repository";
import type { BankAccount } from "@/server/accounting/types";
import { applyRulesToTransactions } from "@/server/services/rule-processing-service";
import { classifyUnallocatedTransactionsWithAi } from "@/server/services/transaction-classification-service";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import { getAuthorizedSession } from "./bank-connectivity-service";
import { createFnbProvider } from "./providers/fnb/fnb-provider";
import type { BankConnection, BankConnectionAccount } from "./types";
import type { BankProvider } from "./bank-provider";

function connection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: 1,
    companyId: "co_1",
    provider: "FNB",
    environment: "production",
    status: "Connected",
    grantedScope: "accounts transactions",
    tokenExpiresAt: "2026-12-31T00:00:00.000Z",
    lastHealthCheckAt: null,
    lastHealthCheckStatus: null,
    lastErrorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    disconnectedAt: null,
    ...overrides,
  };
}

function linkedAccount(overrides: Partial<BankConnectionAccount> = {}): BankConnectionAccount {
  return {
    id: 10,
    companyId: "co_1",
    bankConnectionId: 1,
    bankAccountId: 55,
    providerAccountId: "fnb-acc-1",
    maskedAccountNumber: "•••• 1234",
    accountHolderName: "Acme Ltd",
    currency: "ZAR",
    status: "Active",
    lastSyncedThrough: null,
    lastSyncStatus: null,
    lastSyncAt: null,
    lastTransactionReceivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function bankAccount(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: 55,
    companyId: "co_1",
    accountNumber: "62050837304",
    accountName: "Business Cheque Account",
    bankName: "First National Bank",
    accountType: "Cheque",
    branch: "250655",
    currency: "ZAR",
    status: "Active",
    openingBalance: 0,
    currentBalance: 0,
    lastReconciliationDate: null,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    glAccount: "1000",
    openingBalanceDate: null,
    openingBalanceReference: "",
    ...overrides,
  };
}

function fnbTransaction(id: string, date: string, amount: number, direction: "debit" | "credit" = "debit") {
  return { providerTransactionId: id, date, description: "d", reference: "r", amount, direction, balanceAfter: 100, currency: "ZAR" };
}

function mockProvider(getTransactionsImpl: BankProvider["getTransactions"]): BankProvider {
  return {
    name: "FNB",
    capabilities: { supportsOAuthAuthorizationCode: true, supportsTokenRefresh: true, supportsBalances: true, supportsTransactionHistory: true, supportsRealtimeNotifications: false },
    getAuthorizationUrl: vi.fn(),
    exchangeAuthorizationCode: vi.fn(),
    refreshAccessToken: vi.fn(),
    getAccounts: vi.fn(),
    getAccountBalance: vi.fn(),
    getTransactions: getTransactionsImpl,
    disconnect: vi.fn(),
    healthCheck: vi.fn(),
  };
}

const NOW = "2026-08-11T10:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthorizedSession).mockResolvedValue({ accessToken: "the-access-token" });
  vi.mocked(classifyUnallocatedTransactionsWithAi).mockResolvedValue({ classified: 0, skipped: 0, failed: 0 } as never);
  vi.mocked(recordUsageEvent).mockResolvedValue(undefined as never);
  vi.mocked(getBankAccount).mockResolvedValue(bankAccount());
  vi.mocked(connectivityRepo.startBankSyncRun).mockResolvedValue({
    id: 900,
    companyId: "co_1",
    bankConnectionAccountId: 10,
    syncType: "Initial",
    status: "Running",
    rangeStart: "2026-05-13",
    rangeEnd: "2026-08-11",
    transactionsFetched: 0,
    transactionsImported: 0,
    transactionsDuplicate: 0,
    errorMessage: null,
    startedAt: NOW,
    finishedAt: null,
  });
});

describe("syncBankConnectionAccount — first sync", () => {
  it("uses the 90-day lookback range when there is no cursor yet (first sync)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });

    await syncBankConnectionAccount("co_1", linkedAccount({ lastSyncedThrough: null }), connection(), NOW);

    expect(connectivityRepo.startBankSyncRun).toHaveBeenCalledWith("co_1", 10, "Initial", "2026-05-13", "2026-08-11");
  });

  it("imports every fetched transaction on a clean first sync", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100), fnbTransaction("t2", "2026-08-02", 50, "credit")])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockImplementation(async (_companyId, txn) => ({ transaction: { id: Math.random(), reference: txn.reference } as never, created: true }));

    const outcome = await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW);

    expect(outcome.transactionsImported).toBe(2);
    expect(outcome.transactionsDuplicate).toBe(0);
    expect(importRepo.ingestBankTransactionIdempotent).toHaveBeenCalledTimes(2);
  });

  it("runs Banking Rules only against the genuinely newly-created transactions (no second processing engine)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 777 } as never, created: true });

    await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW);

    expect(applyRulesToTransactions).toHaveBeenCalledWith("co_1", [777], "System");
  });

  it("a transient usage-metering failure does not fail the sync, skip AI classification, or block the cursor from advancing (Phase 25I)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 777 } as never, created: true });
    vi.mocked(recordUsageEvent).mockRejectedValue(new Error("usage_events table unreachable"));

    const outcome = await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW);

    expect(outcome.transactionsImported).toBe(1);
    expect(classifyUnallocatedTransactionsWithAi).toHaveBeenCalledWith("co_1", [777], "System");
    expect(connectivityRepo.finishBankSyncRun).toHaveBeenCalledWith("co_1", expect.anything(), expect.objectContaining({ status: "Success" }), expect.anything());
    expect(connectivityRepo.recordSuccessfulSyncCursor).toHaveBeenCalled();
  });
});

describe("syncBankConnectionAccount — correct bank-account association", () => {
  it("associates every ingested transaction with the linked account's real bankAccountId, never a different one", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });

    await syncBankConnectionAccount("co_1", linkedAccount({ bankAccountId: 999 }), connection(), NOW);

    expect(importRepo.ingestBankTransactionIdempotent).toHaveBeenCalledWith("co_1", expect.objectContaining({ bankAccountId: 999 }));
  });

  it("scopes every repository call to the exact company that owns this connection (tenant isolation)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });

    await syncBankConnectionAccount("company-a", linkedAccount(), connection({ companyId: "company-a" }), NOW);

    expect(importRepo.ingestBankTransactionIdempotent).toHaveBeenCalledWith("company-a", expect.anything());
    expect(connectivityRepo.startBankSyncRun).toHaveBeenCalledWith("company-a", expect.anything(), expect.anything(), expect.anything(), expect.anything());
    expect(connectivityRepo.finishBankSyncRun).toHaveBeenCalledWith("company-a", expect.anything(), expect.anything(), expect.anything());
    expect(connectivityRepo.recordSuccessfulSyncCursor).toHaveBeenCalledWith("company-a", expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });
});

describe("syncBankConnectionAccount — repeated sync does not duplicate", () => {
  it("counts every re-fetched, already-on-file transaction as a duplicate, not a re-import", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100), fnbTransaction("t2", "2026-08-02", 50)])));
    // Simulates ingestBankTransactionIdempotent's own real behaviour: the
    // second time the exact same natural key is inserted, the unique
    // constraint makes it come back created:false.
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: false });

    const outcome = await syncBankConnectionAccount("co_1", linkedAccount({ lastSyncedThrough: "2026-08-01" }), connection(), NOW);

    expect(outcome.transactionsImported).toBe(0);
    expect(outcome.transactionsDuplicate).toBe(2);
    // No newly-created rows -> Banking Rules never re-runs against
    // already-processed transactions.
    expect(applyRulesToTransactions).not.toHaveBeenCalled();
  });

  it("re-requesting the exact same range twice never moves transactionsImported into positive on the second call", async () => {
    const provider = mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)]));
    vi.mocked(createFnbProvider).mockReturnValue(provider);

    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValueOnce({ transaction: { id: 1 } as never, created: true });
    const first = await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW);
    expect(first.transactionsImported).toBe(1);

    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValueOnce({ transaction: { id: 1 } as never, created: false });
    const second = await syncBankConnectionAccount("co_1", linkedAccount({ lastSyncedThrough: "2026-08-11" }), connection(), NOW);
    expect(second.transactionsImported).toBe(0);
    expect(second.transactionsDuplicate).toBe(1);
  });
});

describe("syncBankConnectionAccount — failed sync does not move the cursor", () => {
  it("never calls recordSuccessfulSyncCursor when the provider call throws", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(
      mockProvider(vi.fn().mockRejectedValue(new Error("FNB API request failed (status 500)."))),
    );

    await expect(syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW)).rejects.toThrow("FNB API request failed");

    expect(connectivityRepo.recordSuccessfulSyncCursor).not.toHaveBeenCalled();
    expect(connectivityRepo.recordFailedSync).toHaveBeenCalledWith("co_1", 10, NOW);
    expect(connectivityRepo.finishBankSyncRun).toHaveBeenCalledWith("co_1", 900, expect.objectContaining({ status: "Failed" }), NOW);
  });

  it("leaves the cursor untouched even if some transactions were already fetched before a later failure in the same run", async () => {
    // ingestBankTransactionIdempotent itself throwing partway through
    // (e.g. a transient DB error) — the whole run fails, and the cursor
    // must not advance even though some earlier rows might have committed.
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100), fnbTransaction("t2", "2026-08-02", 50)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValueOnce({ transaction: { id: 1 } as never, created: true }).mockRejectedValueOnce(new Error("db unreachable"));

    await expect(syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW)).rejects.toThrow("db unreachable");
    expect(connectivityRepo.recordSuccessfulSyncCursor).not.toHaveBeenCalled();
  });

  it("records the real counts that landed before a mid-batch failure on the Failed run row, instead of fabricated zeros (Phase 25K)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(
      mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100), fnbTransaction("t2", "2026-08-02", 50), fnbTransaction("t3", "2026-08-03", 25)])),
    );
    vi.mocked(importRepo.ingestBankTransactionIdempotent)
      .mockResolvedValueOnce({ transaction: { id: 1 } as never, created: true })
      .mockResolvedValueOnce({ transaction: { id: 2 } as never, created: false })
      .mockRejectedValueOnce(new Error("db unreachable"));

    await expect(syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW)).rejects.toThrow("db unreachable");

    expect(connectivityRepo.finishBankSyncRun).toHaveBeenCalledWith(
      "co_1",
      900,
      expect.objectContaining({ status: "Failed", transactionsFetched: 3, transactionsImported: 1, transactionsDuplicate: 1 }),
      NOW,
    );
  });

  it("records zero counts on a Failed run when the provider call itself fails before any transaction was fetched", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockRejectedValue(new Error("FNB API request failed (status 500)."))));

    await expect(syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW)).rejects.toThrow("FNB API request failed");

    expect(connectivityRepo.finishBankSyncRun).toHaveBeenCalledWith(
      "co_1",
      900,
      expect.objectContaining({ status: "Failed", transactionsFetched: 0, transactionsImported: 0, transactionsDuplicate: 0 }),
      NOW,
    );
  });
});

describe("syncBankConnectionAccount — cross-channel natural-key consistency (Phase 25K)", () => {
  it("uses the canonical raw account number from ae_bank_accounts as the natural key, not FNB's masked account number", async () => {
    vi.mocked(getBankAccount).mockResolvedValue(bankAccount({ id: 55, accountNumber: "62050837304" }));
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });

    await syncBankConnectionAccount("co_1", linkedAccount({ bankAccountId: 55, maskedAccountNumber: "•••• 1234" }), connection(), NOW);

    expect(getBankAccount).toHaveBeenCalledWith("co_1", 55);
    expect(importRepo.ingestBankTransactionIdempotent).toHaveBeenCalledWith("co_1", expect.objectContaining({ bankAccount: "62050837304" }));
  });

  it("this is the exact value manual/email import would have used for the same account, so an overlapping date range dedups instead of double-importing", async () => {
    // Manual/email import resolves `ae_bank_accounts.account_number` and
    // writes that same raw string as the transaction's natural-key
    // `bank_account` field — confirming the sync path now writes the
    // identical value closes the cross-channel dedup gap.
    vi.mocked(getBankAccount).mockResolvedValue(bankAccount({ accountNumber: "62050837304" }));
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });

    await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW);

    const call = vi.mocked(importRepo.ingestBankTransactionIdempotent).mock.calls[0][1];
    expect(call.bankAccount).toBe("62050837304");
    expect(call.bankAccount).not.toBe("•••• 1234");
  });

  it("falls back to the masked account number only if the linked bankAccountId doesn't resolve to a real ae_bank_accounts row (defensive)", async () => {
    vi.mocked(getBankAccount).mockResolvedValue(null);
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });

    await syncBankConnectionAccount("co_1", linkedAccount({ maskedAccountNumber: "•••• 1234" }), connection(), NOW);

    expect(importRepo.ingestBankTransactionIdempotent).toHaveBeenCalledWith("co_1", expect.objectContaining({ bankAccount: "•••• 1234" }));
  });
});

describe("syncAllConnectedAccounts — partial failure", () => {
  it("keeps syncing the remaining accounts after one account's sync fails", async () => {
    vi.mocked(connectivityRepo.listConnectedBankConnections).mockResolvedValue([connection({ id: 1 }), connection({ id: 2 })]);
    vi.mocked(connectivityRepo.listBankConnectionAccounts).mockImplementation(async (_companyId, connectionId) =>
      connectionId === 1 ? [linkedAccount({ id: 10, bankConnectionId: 1, providerAccountId: "fails" })] : [linkedAccount({ id: 20, bankConnectionId: 2, providerAccountId: "succeeds" })],
    );

    const failingProvider = mockProvider(vi.fn().mockRejectedValue(new Error("boom")));
    const succeedingProvider = mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 10)]));
    vi.mocked(createFnbProvider).mockReturnValueOnce(failingProvider).mockReturnValueOnce(succeedingProvider);
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });

    const summary = await syncAllConnectedAccounts("co_1", NOW);

    expect(summary).toEqual({ attempted: 2, succeeded: 1, failed: 1 });
  });

  it("only attempts Active linked accounts, skipping Disconnected ones", async () => {
    vi.mocked(connectivityRepo.listConnectedBankConnections).mockResolvedValue([connection({ id: 1 })]);
    vi.mocked(connectivityRepo.listBankConnectionAccounts).mockResolvedValue([linkedAccount({ id: 10, status: "Active" }), linkedAccount({ id: 11, status: "Disconnected" })]);
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([])));

    const summary = await syncAllConnectedAccounts("co_1", NOW);

    expect(summary.attempted).toBe(1);
  });

  it("returns a trivial zero summary for a company with no connected banks (empty data)", async () => {
    vi.mocked(connectivityRepo.listConnectedBankConnections).mockResolvedValue([]);
    const summary = await syncAllConnectedAccounts("co_1", NOW);
    expect(summary).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
  });
});

describe("syncBankConnectionAccount — AI classification (Phase 25E)", () => {
  it("classifies newly-synced transactions with AI, after Banking Rules, on the same ids and company", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 777 } as never, created: true });

    await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW, "Scheduler");

    expect(classifyUnallocatedTransactionsWithAi).toHaveBeenCalledWith("co_1", [777], "Scheduler");
  });

  it("runs AI classification only after Banking Rules have completed for this sync (call order)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });

    const order: string[] = [];
    vi.mocked(applyRulesToTransactions).mockImplementation(async () => {
      order.push("rules");
      return [];
    });
    vi.mocked(classifyUnallocatedTransactionsWithAi).mockImplementation(async () => {
      order.push("ai");
      return { classified: 0, skipped: 0, failed: 0 } as never;
    });

    await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW);

    expect(order).toEqual(["rules", "ai"]);
  });

  it("never calls AI classification when a sync produces no newly-created transactions (duplicate-only)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: false });

    await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW);

    expect(classifyUnallocatedTransactionsWithAi).not.toHaveBeenCalled();
  });

  it("a bank sync still succeeds (Success status, cursor advances) even when AI classification rejects entirely", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });
    vi.mocked(classifyUnallocatedTransactionsWithAi).mockRejectedValue(new Error("AI gateway unavailable"));

    const outcome = await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW);

    expect(outcome.run.status).toBe("Success");
    expect(connectivityRepo.recordSuccessfulSyncCursor).toHaveBeenCalled();
    expect(connectivityRepo.finishBankSyncRun).toHaveBeenCalledWith("co_1", expect.anything(), expect.objectContaining({ status: "Success" }), NOW);
  });

  it("a bank sync still succeeds when AI classification resolves with an all-failed outcome (provider/gateway unavailable, already handled inside the shared service)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });
    vi.mocked(classifyUnallocatedTransactionsWithAi).mockResolvedValue({ classified: 0, skipped: 0, failed: 1 } as never);

    const outcome = await syncBankConnectionAccount("co_1", linkedAccount(), connection(), NOW);

    expect(outcome.run.status).toBe("Success");
  });

  it("scopes the AI classification call to the exact company that owns this sync (tenant isolation)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(mockProvider(vi.fn().mockResolvedValue([fnbTransaction("t1", "2026-08-01", 100)])));
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 1 } as never, created: true });

    await syncBankConnectionAccount("company-a", linkedAccount(), connection({ companyId: "company-a" }), NOW);

    expect(classifyUnallocatedTransactionsWithAi).toHaveBeenCalledWith("company-a", expect.anything(), expect.anything());
  });
});
