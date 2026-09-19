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
vi.mock("@/server/services/rule-processing-service", () => ({
  // Phase 5C — the import now runs the BOUNDED rule pass.
  applyRulesToTransactionsBounded: vi.fn(),
  attachedRulePassBounds: vi.fn(() => ({ deadlineAtMs: 9_999_999_999_999, maxPostings: 150, now: Date.now })),
}));
vi.mock("@/server/services/transaction-classification-service", () => ({ classifyUnallocatedTransactionsWithAi: vi.fn() }));
vi.mock("@/server/services/company-service", () => ({ getCompany: vi.fn() }));

import { confirmPdfBankStatementImport, importBankStatement } from "./import-service";
import { resolveBankStatementAdapter } from "@/server/import-centre/bank-statement-adapter-registry";
import * as importRepo from "@/server/repositories/import-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import { applyRulesToTransactionsBounded } from "@/server/services/rule-processing-service";
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
  vi.mocked(applyRulesToTransactionsBounded).mockReset().mockResolvedValue({ results: [{ autoPosted: false }], outcomes: {}, postingAttempts: 0, notAttempted: 0, notAttemptedTransactionIds: [], stopReason: null, notPermitted: 0, notPermittedTransactionIds: [] } as never);
  vi.mocked(classifyUnallocatedTransactionsWithAi).mockReset().mockResolvedValue({ attempted: 1, classified: 1, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 } as never);
  vi.mocked(recordUsageEvent).mockReset().mockResolvedValue(undefined as never);
});

describe("importBankStatement — AI classification wiring", () => {
  it("calls AI classification with the newly created transaction ids, after Banking Rules", async () => {
    await importBankStatement("company-a", fakeFile(), "tester");

    expect(applyRulesToTransactionsBounded).toHaveBeenCalledWith("company-a", [501], "tester", [], expect.objectContaining({ mayPost: true }));
    expect(classifyUnallocatedTransactionsWithAi).toHaveBeenCalledWith("company-a", [501], "tester");

    const rulesCallOrder = vi.mocked(applyRulesToTransactionsBounded).mock.invocationCallOrder[0]!;
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

    expect(applyRulesToTransactionsBounded).toHaveBeenCalledTimes(1);
  });

  it("a transient usage-metering failure does not fail the import or skip Banking Rules/AI classification (Phase 25I)", async () => {
    vi.mocked(recordUsageEvent).mockRejectedValue(new Error("usage_events table unreachable"));

    const outcome = await importBankStatement("company-a", fakeFile(), "tester");

    expect(outcome.batch).toEqual({ id: 1 });
    expect(applyRulesToTransactionsBounded).toHaveBeenCalledWith("company-a", [501], "tester", [], expect.objectContaining({ mayPost: true }));
    expect(classifyUnallocatedTransactionsWithAi).toHaveBeenCalledWith("company-a", [501], "tester");
  });
});

describe("Phase 5C — import creates transactions with Banking:Create; posting them needs Banking:Post", () => {
  it("mayPost false reaches the rule pass, and the import still completes in full", async () => {
    const outcome = await importBankStatement("company-a", fakeFile(), "tester", { mayPost: false });

    expect(outcome.batch).toEqual({ id: 1 });
    expect(applyRulesToTransactionsBounded).toHaveBeenCalledWith("company-a", [501], "tester", [], expect.objectContaining({ mayPost: false }));
    // The transactions themselves were still created.
    expect(importRepo.ingestBankTransactionIdempotent).toHaveBeenCalled();
  });

  it("omitting the option means may-post — the inbound-email/service path is unchanged", async () => {
    await importBankStatement("company-a", fakeFile(), "tester");
    expect(applyRulesToTransactionsBounded).toHaveBeenCalledWith("company-a", [501], "tester", [], expect.objectContaining({ mayPost: true }));
  });

  it("the import surfaces what the rule pass left unposted or unstarted, and why", async () => {
    vi.mocked(applyRulesToTransactionsBounded).mockResolvedValue({
      results: [], outcomes: {}, postingAttempts: 0, notAttempted: 4, notAttemptedTransactionIds: [1, 2, 3, 4],
      stopReason: "time-budget", notPermitted: 7, notPermittedTransactionIds: [],
    } as never);

    const outcome = await importBankStatement("company-a", fakeFile(), "tester", { mayPost: false });
    expect(outcome.rulePass).toEqual({ notPermitted: 7, notAttempted: 4, stopReason: "time-budget" });
  });

  it("the rule pass an import runs is BOUNDED", async () => {
    await importBankStatement("company-a", fakeFile(), "tester");
    const options = vi.mocked(applyRulesToTransactionsBounded).mock.calls[0]![4]!;
    expect(options.bounds).toMatchObject({ maxPostings: 150 });
    expect(options.bounds!.deadlineAtMs).toBeGreaterThan(0);
  });

  it("an import with no newly created transactions reports a clean rule pass and runs none", async () => {
    vi.mocked(importRepo.ingestBankTransactionIdempotent).mockResolvedValue({ transaction: { id: 501 } as never, created: false });
    const outcome = await importBankStatement("company-a", fakeFile(), "tester", { mayPost: false });
    expect(outcome.rulePass).toEqual({ notPermitted: 0, notAttempted: 0, stopReason: null });
    expect(applyRulesToTransactionsBounded).not.toHaveBeenCalled();
  });

  it("the PDF confirm path separates the two permissions identically", async () => {
    const input = { batchId: "B1", sourceFilename: "s.pdf", metadata: {}, transactions: [{ transactionDate: "2026-01-01", description: "x", beneficiary: "x", debit: 1, credit: 0, reference: "", balance: null, bankAccount: "Cheque", vat: null, glAccount: "", notes: "" }] } as never;

    await confirmPdfBankStatementImport("company-a", input, "tester", { mayPost: false });
    expect(applyRulesToTransactionsBounded).toHaveBeenCalledWith("company-a", [501], "tester", [], expect.objectContaining({ mayPost: false }));

    vi.mocked(applyRulesToTransactionsBounded).mockClear();
    await confirmPdfBankStatementImport("company-a", input, "tester");
    expect(applyRulesToTransactionsBounded).toHaveBeenCalledWith("company-a", [501], "tester", [], expect.objectContaining({ mayPost: true }));
  });

  it("tenant isolation: the rule pass is scoped to the company being imported into", async () => {
    await importBankStatement("company-b", fakeFile(), "tester", { mayPost: false });
    expect(vi.mocked(applyRulesToTransactionsBounded).mock.calls[0]![0]).toBe("company-b");
  });
});
