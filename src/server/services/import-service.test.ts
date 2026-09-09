/**
 * Phase 22A — proves the new AI Transaction Classification hook wired
 * into `importBankStatement`/`confirmPdfBankStatementImport` runs AFTER
 * Banking Rules and can never fail the import itself, without needing to
 * exercise this file's full CSV/PDF parsing machinery — every external
 * dependency is mocked, matching this codebase's established pattern
 * (see `inbound-bank-statement-email-service.test.ts` for the same
 * "mock everything, prove the sequencing/safety contract" approach).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/import-centre/bank-statement-adapter-registry", async () => {
  const actual = await vi.importActual<typeof import("@/server/import-centre/bank-statement-adapter-registry")>("@/server/import-centre/bank-statement-adapter-registry");
  return { ...actual, resolveBankStatementAdapter: vi.fn() };
});
vi.mock("@/server/repositories/import-repository", () => ({
  ingestBankTransactionIdempotent: vi.fn(),
  insertImportBatch: vi.fn(),
}));
vi.mock("@/server/repositories/bank-account-repository", () => ({ getOrCreateBankAccountByNumber: vi.fn() }));
vi.mock("@/server/billing-platform/engine/usage-metering-engine", () => ({ recordUsageEvent: vi.fn() }));
vi.mock("@/server/services/rule-processing-service", () => ({ applyRulesToTransactions: vi.fn() }));
vi.mock("@/server/services/transaction-classification-service", () => ({ classifyUnallocatedTransactionsWithAi: vi.fn() }));
vi.mock("@/server/services/company-service", () => ({ getCompany: vi.fn() }));

import { importBankStatement } from "./import-service";
import { resolveBankStatementAdapter } from "@/server/import-centre/bank-statement-adapter-registry";
import * as importRepo from "@/server/repositories/import-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import { applyRulesToTransactions } from "@/server/services/rule-processing-service";
import { classifyUnallocatedTransactionsWithAi } from "@/server/services/transaction-classification-service";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";

function fakeFile(name = "statement.csv"): File {
  return new File(["date,amount\n2026-01-01,100"], name, { type: "text/csv" });
}

function fakeAdapter(transactions: unknown[] = [{ transactionDate: "2026-01-01", reference: "", description: "Pick n Pay", beneficiary: "Pick n Pay", debit: 100, credit: 0, balance: null, bankAccount: "Cheque", vat: null, glAccount: "", notes: "" }]) {
  return { parse: vi.fn().mockResolvedValue({ transactions, exceptions: [] }) };
}

beforeEach(() => {
  vi.mocked(resolveBankStatementAdapter).mockReset().mockReturnValue(fakeAdapter() as never);
  vi.mocked(bankAccountRepo.getOrCreateBankAccountByNumber).mockReset().mockResolvedValue({ account: { id: 1 } as never, created: false });
  vi.mocked(importRepo.ingestBankTransactionIdempotent).mockReset().mockResolvedValue({ transaction: { id: 501 } as never, created: true });
  vi.mocked(importRepo.insertImportBatch).mockReset().mockResolvedValue({ id: 1 } as never);
  vi.mocked(applyRulesToTransactions).mockReset().mockResolvedValue([{ autoPosted: false }] as never);
  vi.mocked(classifyUnallocatedTransactionsWithAi).mockReset().mockResolvedValue({ attempted: 1, classified: 1, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 });
  vi.mocked(recordUsageEvent).mockReset().mockResolvedValue(undefined as never);
});

describe("importBankStatement — AI classification wiring", () => {
  it("calls AI classification with the newly created transaction ids, after Banking Rules", async () => {
    await importBankStatement("company-a", fakeFile(), "tester");

    expect(applyRulesToTransactions).toHaveBeenCalledWith("company-a", [501], "tester");
    expect(classifyUnallocatedTransactionsWithAi).toHaveBeenCalledWith("company-a", [501], "tester");

    const rulesCallOrder = vi.mocked(applyRulesToTransactions).mock.invocationCallOrder[0]!;
    const aiCallOrder = vi.mocked(classifyUnallocatedTransactionsWithAi).mock.invocationCallOrder[0]!;
    expect(rulesCallOrder).toBeLessThan(aiCallOrder);
  });

  it("does not call AI classification when no transactions were newly created", async () => {
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 501 } as never, created: false });

    await importBankStatement("company-a", fakeFile(), "tester");

    expect(classifyUnallocatedTransactionsWithAi).not.toHaveBeenCalled();
  });

  it("the import still succeeds when AI classification rejects entirely", async () => {
    vi.mocked(classifyUnallocatedTransactionsWithAi).mockRejectedValue(new Error("AI Gateway unreachable"));

    const outcome = await importBankStatement("company-a", fakeFile(), "tester");

    expect(outcome.batch).toEqual({ id: 1 });
  });

  it("Banking Rules still ran even though AI classification failed", async () => {
    vi.mocked(classifyUnallocatedTransactionsWithAi).mockRejectedValue(new Error("AI Gateway unreachable"));

    await importBankStatement("company-a", fakeFile(), "tester");

    expect(applyRulesToTransactions).toHaveBeenCalledTimes(1);
  });

  it("a transient usage-metering failure does not fail the import or skip Banking Rules/AI classification (Phase 25I)", async () => {
    vi.mocked(recordUsageEvent).mockRejectedValue(new Error("usage_events table unreachable"));

    const outcome = await importBankStatement("company-a", fakeFile(), "tester");

    expect(outcome.batch).toEqual({ id: 1 });
    expect(applyRulesToTransactions).toHaveBeenCalledWith("company-a", [501], "tester");
    expect(classifyUnallocatedTransactionsWithAi).toHaveBeenCalledWith("company-a", [501], "tester");
  });
});
