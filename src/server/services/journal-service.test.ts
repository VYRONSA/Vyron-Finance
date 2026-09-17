import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/journal-repository", () => ({
  createJournal: vi.fn(),
  linkTransactionToJournal: vi.fn(),
  listRuleEngineJournalsForTransactions: vi.fn(),
  updateJournal: vi.fn(),
  cancelJournal: vi.fn(),
}));
vi.mock("@/server/repositories/bank-transaction-split-repository", () => ({ listSplitsForTransaction: vi.fn() }));

import { buildJournalLinesForSplitTransaction, buildJournalLinesForTransaction, generateJournalDraft, generateJournalFromTransactions, resolveBankGlAccount } from "./journal-service";
import * as journalRepo from "@/server/repositories/journal-repository";
import type { BankTransactionRecord, Journal, RuleEngineJournalRef } from "@/server/accounting/types";

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
    glAccount: "",
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

describe("buildJournalLinesForSplitTransaction", () => {
  it("builds one debit GL line per split plus one bank credit line for a payment, balanced", () => {
    const result = buildJournalLinesForSplitTransaction(
      txn({ debit: 500, credit: 0 }),
      [
        { amount: 300, description: "Office supplies", glAccount: "6300" },
        { amount: 200, description: "Travel", glAccount: "6400" },
      ],
      { glAccount: "1000", accountNumber: "MAIN-001" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { accountCode: "6300", debit: 300, credit: 0, description: "Office supplies" },
      { accountCode: "6400", debit: 200, credit: 0, description: "Travel" },
      { accountCode: "1000", debit: 0, credit: 500, description: "Payment to ABC Supplies" },
    ]);
    const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("builds one credit GL line per split plus one bank debit line for a receipt", () => {
    const result = buildJournalLinesForSplitTransaction(
      txn({ debit: 0, credit: 1000 }),
      [
        { amount: 600, description: "Product sales", glAccount: "4000" },
        { amount: 400, description: "Service fees", glAccount: "4100" },
      ],
      { glAccount: "1000", accountNumber: "MAIN-001" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]).toEqual({ accountCode: "1000", debit: 1000, credit: 0, description: "Payment to ABC Supplies" });
  });

  it("rejects splits that don't sum to the transaction amount", () => {
    const result = buildJournalLinesForSplitTransaction(
      txn({ debit: 500, credit: 0 }),
      [
        { amount: 300, description: "a", glAccount: "6300" },
        { amount: 100, description: "b", glAccount: "6400" },
      ],
      { glAccount: "1000", accountNumber: "MAIN-001" },
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a single split line", () => {
    const result = buildJournalLinesForSplitTransaction(txn({ debit: 500, credit: 0 }), [{ amount: 500, description: "a", glAccount: "6300" }], { glAccount: "1000", accountNumber: "MAIN-001" });
    expect(result.ok).toBe(false);
  });

  it("rejects an already-journaled transaction", () => {
    const result = buildJournalLinesForSplitTransaction(
      txn({ debit: 500, credit: 0, journalId: 99 }),
      [
        { amount: 300, description: "a", glAccount: "6300" },
        { amount: 200, description: "b", glAccount: "6400" },
      ],
      { glAccount: "1000", accountNumber: "MAIN-001" },
    );
    expect(result.ok).toBe(false);
  });

  // Master Implementation Tracker — Programme 2, Epic E2, Finding #215.
  it("blocks generation when the bank account has no GL account configured", () => {
    const result = buildJournalLinesForSplitTransaction(
      txn({ debit: 500, credit: 0 }),
      [
        { amount: 300, description: "a", glAccount: "6300" },
        { amount: 200, description: "b", glAccount: "6400" },
      ],
      null,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // The message must name the actual bank account and distinguish the
    // bank's own control account from the one allocated to the row.
    expect(result.reason).toContain("has no GL account configured");
    expect(result.reason).toContain("Configure it under Bank Accounts");
    expect(result.reason).toContain("separate from the GL account allocated to the transaction");
  });
});

describe("resolveBankGlAccount", () => {
  it("uses the bank account's configured GL code when set", () => {
    expect(resolveBankGlAccount({ glAccount: "1000", accountNumber: "62050837304" }, "MAIN-001")).toBe("1000");
  });

  it("falls back to a synthetic BANK-{accountNumber} code when unset", () => {
    expect(resolveBankGlAccount({ glAccount: "", accountNumber: "62050837304" }, "MAIN-001")).toBe("BANK-62050837304");
  });

  it("falls back to the raw bank account label when no bank account record exists", () => {
    expect(resolveBankGlAccount(null, "MAIN-001")).toBe("BANK-MAIN-001");
  });

  it("treats a whitespace-only configured code as unset", () => {
    expect(resolveBankGlAccount({ glAccount: "   ", accountNumber: "62050837304" }, "MAIN-001")).toBe("BANK-62050837304");
  });
});

describe("buildJournalLinesForTransaction", () => {
  const bankAccount = { glAccount: "1000", accountNumber: "62050837304" };

  it("builds a payment (debit) as DR the suggested GL account / CR the bank account", () => {
    const result = buildJournalLinesForTransaction(txn({ debit: 500, credit: 0 }), bankAccount);
    expect(result).toEqual({
      ok: true,
      lines: [
        { accountCode: "6000", debit: 500, credit: 0, description: "Payment to ABC Supplies" },
        { accountCode: "1000", debit: 0, credit: 500, description: "Payment to ABC Supplies" },
      ],
    });
  });

  it("builds a receipt (credit) as DR the bank account / CR the suggested GL account", () => {
    const result = buildJournalLinesForTransaction(txn({ debit: 0, credit: 300 }), bankAccount);
    expect(result).toEqual({
      ok: true,
      lines: [
        { accountCode: "1000", debit: 300, credit: 0, description: "Payment to ABC Supplies" },
        { accountCode: "6000", debit: 0, credit: 300, description: "Payment to ABC Supplies" },
      ],
    });
  });

  it("every generated line pair is self-balancing (debit sum == credit sum)", () => {
    for (const amounts of [{ debit: 500, credit: 0 }, { debit: 0, credit: 300 }, { debit: 0.01, credit: 0 }]) {
      const result = buildJournalLinesForTransaction(txn(amounts), bankAccount);
      if (!result.ok) throw new Error("expected ok");
      const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBeCloseTo(totalCredit, 2);
    }
  });

  it("skips a transaction with no GL account assigned", () => {
    const result = buildJournalLinesForTransaction(txn({ suggestedGlAccount: null }), bankAccount);
    expect(result).toEqual({ ok: false, reason: "No GL account assigned" });
  });

  it("skips a transaction with an empty/whitespace GL account", () => {
    const result = buildJournalLinesForTransaction(txn({ suggestedGlAccount: "   " }), bankAccount);
    expect(result.ok).toBe(false);
  });

  // Master Implementation Tracker — Programme 2, Epic E2, Finding #215.
  describe("bank account GL requirement", () => {
    it("blocks generation when the bank account has no GL account configured", () => {
      const result = buildJournalLinesForTransaction(txn(), { glAccount: "", accountNumber: "62050837304" });
      expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // The message must name the actual bank account and distinguish the
    // bank's own control account from the one allocated to the row.
    expect(result.reason).toContain("has no GL account configured");
    expect(result.reason).toContain("Configure it under Bank Accounts");
    expect(result.reason).toContain("separate from the GL account allocated to the transaction");
    });

    it("blocks generation when there is no bank account at all", () => {
      const result = buildJournalLinesForTransaction(txn(), null);
      expect(result.ok).toBe(false);
    });

    it("no longer silently fabricates a BANK-{accountNumber} code", () => {
      const result = buildJournalLinesForTransaction(txn(), { glAccount: "   ", accountNumber: "62050837304" });
      expect(result.ok).toBe(false);
    });
  });

  // Master Implementation Tracker — Programme 2, Epic E2, Finding #027.
  describe("VAT", () => {
    it("splits a payment into net GL + VAT Control (2300), bank side stays the full gross amount", () => {
      const result = buildJournalLinesForTransaction(txn({ debit: 115, credit: 0, vat: 15 }), bankAccount);
      expect(result).toEqual({
        ok: true,
        lines: [
          { accountCode: "6000", debit: 100, credit: 0, description: "Payment to ABC Supplies" },
          { accountCode: "2300", debit: 15, credit: 0, description: "VAT — Payment to ABC Supplies" },
          { accountCode: "1000", debit: 0, credit: 115, description: "Payment to ABC Supplies" },
        ],
      });
    });

    it("splits a receipt into bank side (full gross) + net GL + VAT Control (2300)", () => {
      const result = buildJournalLinesForTransaction(txn({ debit: 0, credit: 230, vat: 30 }), bankAccount);
      expect(result).toEqual({
        ok: true,
        lines: [
          { accountCode: "1000", debit: 230, credit: 0, description: "Payment to ABC Supplies" },
          { accountCode: "6000", debit: 0, credit: 200, description: "Payment to ABC Supplies" },
          { accountCode: "2300", debit: 0, credit: 30, description: "VAT — Payment to ABC Supplies" },
        ],
      });
    });

    it("stays a plain 2-line entry when vat is null or zero", () => {
      const result = buildJournalLinesForTransaction(txn({ debit: 500, credit: 0, vat: 0 }), bankAccount);
      expect(result.ok && result.lines).toHaveLength(2);
    });

    it("falls back to a plain 2-line entry (no VAT split) rather than trusting a nonsensical VAT value >= the gross amount", () => {
      const result = buildJournalLinesForTransaction(txn({ debit: 100, credit: 0, vat: 100 }), bankAccount);
      expect(result.ok && result.lines).toHaveLength(2);
      expect(result.ok && result.lines[0]).toEqual({ accountCode: "6000", debit: 100, credit: 0, description: "Payment to ABC Supplies" });
    });

    it("every VAT-split line pair is still self-balancing", () => {
      for (const amounts of [{ debit: 115, credit: 0, vat: 15 }, { debit: 0, credit: 230, vat: 30 }]) {
        const result = buildJournalLinesForTransaction(txn(amounts), bankAccount);
        if (!result.ok) throw new Error("expected ok");
        const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
        expect(totalDebit).toBeCloseTo(totalCredit, 2);
      }
    });
  });

  it("skips a transaction already linked to a journal", () => {
    const result = buildJournalLinesForTransaction(txn({ journalId: 42 }), bankAccount);
    expect(result).toEqual({ ok: false, reason: "Already linked to a journal" });
  });

  it("skips a transaction with both debit and credit populated", () => {
    const result = buildJournalLinesForTransaction(txn({ debit: 100, credit: 50 }), bankAccount);
    expect(result.ok).toBe(false);
  });

  it("skips a transaction with neither debit nor credit populated", () => {
    const result = buildJournalLinesForTransaction(txn({ debit: 0, credit: 0 }), bankAccount);
    expect(result.ok).toBe(false);
  });

  // Superseded by Finding #215 (see "bank account GL requirement" below)
  // — a bank account with no configured GL account now blocks generation
  // instead of silently falling back to a synthetic, non-existent code.
});

describe("generateJournalDraft", () => {
  const bankAccountsById = new Map([[1, { glAccount: "1000", accountNumber: "62050837304" }]]);

  it("combines self-balancing pairs from multiple eligible transactions into one balanced set of lines", () => {
    const transactions = [txn({ id: 1, debit: 500 }), txn({ id: 2, debit: 0, credit: 300 })];
    const { lines, includedTransactionIds, skipped } = generateJournalDraft(transactions, bankAccountsById);
    expect(includedTransactionIds).toEqual([1, 2]);
    expect(skipped).toEqual([]);
    expect(lines).toHaveLength(4);
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
  });

  it("reports skipped transactions with a reason instead of silently dropping them", () => {
    const transactions = [txn({ id: 1, debit: 500 }), txn({ id: 2, suggestedGlAccount: null })];
    const { includedTransactionIds, skipped } = generateJournalDraft(transactions, bankAccountsById);
    expect(includedTransactionIds).toEqual([1]);
    expect(skipped).toEqual([{ transactionId: 2, reason: "No GL account assigned" }]);
  });

  it("resolves each transaction's bank account independently by bankAccountId", () => {
    const twoAccounts = new Map([
      [1, { glAccount: "1000", accountNumber: "AAA" }],
      [2, { glAccount: "1010", accountNumber: "BBB" }],
    ]);
    const transactions = [txn({ id: 1, bankAccountId: 1, debit: 500 }), txn({ id: 2, bankAccountId: 2, debit: 200 })];
    const { lines } = generateJournalDraft(transactions, twoAccounts);
    expect(lines.map((l) => l.accountCode)).toEqual(["6000", "1000", "6000", "1010"]);
  });

  it("returns an empty result when every transaction is ineligible, without throwing", () => {
    const transactions = [txn({ id: 1, journalId: 9 }), txn({ id: 2, suggestedGlAccount: null })];
    const { lines, includedTransactionIds, skipped } = generateJournalDraft(transactions, bankAccountsById);
    expect(lines).toEqual([]);
    expect(includedTransactionIds).toEqual([]);
    expect(skipped).toHaveLength(2);
  });
});

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    id: 500, companyId: "co_1", journalNumber: "JR000500", journalDate: "2026-07-01", journalType: "Bank Transactions",
    description: "", reference: "", sourceType: "bank_transactions_bulk", sourceId: null, status: "Draft",
    totalDebit: 500, totalCredit: 500, createdAt: "2026-07-01T00:00:00Z", postedAt: null,
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null,
    cancelledBy: null, cancelledAt: null, isReversed: false, reversalOfJournalId: null, reversedByJournalId: null,
    ...overrides,
  } as Journal;
}

describe("generateJournalFromTransactions — posted-during-generation race guard (Phase 25K)", () => {
  const bankAccountsById = new Map([[1, { glAccount: "1000", accountNumber: "MAIN-001" }]]);

  beforeEach(() => {
    vi.mocked(journalRepo.createJournal).mockReset().mockResolvedValue(journal());
    vi.mocked(journalRepo.linkTransactionToJournal).mockReset().mockResolvedValue(true);
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockReset().mockResolvedValue(new Map());
    vi.mocked(journalRepo.updateJournal).mockReset().mockImplementation(async () => journal({ description: "rebuilt" }));
    vi.mocked(journalRepo.cancelJournal).mockReset().mockImplementation(async () => journal({ status: "Cancelled" }));
  });

  it("links every eligible transaction normally when nothing races the generation (baseline, unchanged behavior)", async () => {
    const transactions = [txn({ id: 1, debit: 500 }), txn({ id: 2, debit: 200 })];

    const outcome = await generateJournalFromTransactions("co_1", transactions, bankAccountsById);

    expect(journalRepo.linkTransactionToJournal).toHaveBeenCalledWith("co_1", 1, 500);
    expect(journalRepo.linkTransactionToJournal).toHaveBeenCalledWith("co_1", 2, 500);
    expect(outcome.includedTransactionIds).toEqual([1, 2]);
    expect(outcome.skipped).toEqual([]);
  });

  it("reports a transaction posted by another process DURING generation as skipped, not included, instead of silently re-linking it (the core fix)", async () => {
    const transactions = [txn({ id: 1, debit: 500 }), txn({ id: 2, debit: 200 })];
    vi.mocked(journalRepo.linkTransactionToJournal).mockImplementation(async (_companyId, id) => id !== 2);

    const outcome = await generateJournalFromTransactions("co_1", transactions, bankAccountsById);

    expect(outcome.includedTransactionIds).toEqual([1]);
    expect(outcome.skipped).toEqual([{ transactionId: 2, reason: expect.stringContaining("Posted by another process during journal generation") }]);
  });

  it("combines race-skipped transactions with genuinely-ineligible ones (e.g. no GL account) in the same skipped list", async () => {
    const transactions = [txn({ id: 1, debit: 500 }), txn({ id: 2, debit: 200 }), txn({ id: 3, suggestedGlAccount: null })];
    vi.mocked(journalRepo.linkTransactionToJournal).mockImplementation(async (_companyId, id) => id !== 2);

    const outcome = await generateJournalFromTransactions("co_1", transactions, bankAccountsById);

    expect(outcome.includedTransactionIds).toEqual([1]);
    expect(outcome.skipped).toEqual(
      expect.arrayContaining([
        { transactionId: 3, reason: "No GL account assigned" },
        { transactionId: 2, reason: expect.stringContaining("Posted by another process during journal generation") },
      ]),
    );
  });
});

describe("Migration 0100 — H. Generate Journal never journals an amount a Banking Rule journal already carries", () => {
  const bankAccountsById = new Map([[1, { glAccount: "1000", accountNumber: "MAIN-001" }]]);
  const ruleJournal = (overrides: Partial<RuleEngineJournalRef> = {}): RuleEngineJournalRef => ({ id: 278, journalNumber: "JR000264", status: "Posted", isReversed: false, sourceId: 2, ...overrides });

  beforeEach(() => {
    vi.mocked(journalRepo.createJournal).mockReset().mockResolvedValue(journal());
    vi.mocked(journalRepo.linkTransactionToJournal).mockReset().mockResolvedValue(true);
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockReset().mockResolvedValue(new Map());
    vi.mocked(journalRepo.updateJournal).mockReset().mockImplementation(async () => journal({ description: "rebuilt" }));
    vi.mocked(journalRepo.cancelJournal).mockReset().mockImplementation(async () => journal({ status: "Cancelled" }));
  });

  it("skips (before creating anything) a transaction whose Banking Rule journal is Posted, even with journal_id NULL", async () => {
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockResolvedValue(new Map([[2, ruleJournal()]]));
    const transactions = [txn({ id: 1, debit: 500 }), txn({ id: 2, debit: 6435 })];

    const outcome = await generateJournalFromTransactions("co_1", transactions, bankAccountsById);

    expect(journalRepo.listRuleEngineJournalsForTransactions).toHaveBeenCalledWith("co_1", [1, 2]);
    const createdLines = vi.mocked(journalRepo.createJournal).mock.calls[0]![1].lines;
    expect(createdLines.reduce((sum, l) => sum + l.debit, 0)).toBe(500);
    expect(journalRepo.linkTransactionToJournal).not.toHaveBeenCalledWith("co_1", 2, expect.anything());
    expect(outcome.includedTransactionIds).toEqual([1]);
    expect(outcome.skipped).toEqual([{ transactionId: 2, reason: expect.stringContaining("JR000264") }]);
  });

  it("creates no journal at all when every selected transaction is covered", async () => {
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockResolvedValue(new Map([[2, ruleJournal({ status: "Approved" })]]));
    const outcome = await generateJournalFromTransactions("co_1", [txn({ id: 2 })], bankAccountsById);
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(outcome).toEqual({ journal: null, includedTransactionIds: [], skipped: [{ transactionId: 2, reason: expect.stringContaining("Approved") }] });
  });

  it("does not skip for a reversed or cancelled Banking Rule journal", async () => {
    vi.mocked(journalRepo.listRuleEngineJournalsForTransactions).mockResolvedValue(new Map([[2, ruleJournal({ isReversed: true })]]));
    const outcome = await generateJournalFromTransactions("co_1", [txn({ id: 2 })], bankAccountsById);
    expect(outcome.includedTransactionIds).toEqual([2]);
  });

  it("rebuilds the draft from the linked transactions only when the database refuses a link, so the draft cannot double-post it", async () => {
    // The database guard (or a concurrent poster) refuses transaction 2.
    vi.mocked(journalRepo.linkTransactionToJournal).mockImplementation(async (_co, id) => id !== 2);
    const transactions = [txn({ id: 1, debit: 500 }), txn({ id: 2, debit: 200 })];

    const outcome = await generateJournalFromTransactions("co_1", transactions, bankAccountsById);

    expect(journalRepo.updateJournal).toHaveBeenCalledTimes(1);
    const [, journalId, fields] = vi.mocked(journalRepo.updateJournal).mock.calls[0]!;
    expect(journalId).toBe(500);
    expect(fields.description).toBe("Generated from 1 transaction(s)");
    expect(fields.lines).toEqual([
      { accountCode: "6000", debit: 500, credit: 0, description: "Payment to ABC Supplies" },
      { accountCode: "1000", debit: 0, credit: 500, description: "Payment to ABC Supplies" },
    ]);
    expect(outcome.journal?.description).toBe("rebuilt");
    expect(outcome.includedTransactionIds).toEqual([1]);
  });

  it("cancels the draft when no link landed at all", async () => {
    vi.mocked(journalRepo.linkTransactionToJournal).mockResolvedValue(false);
    const outcome = await generateJournalFromTransactions("co_1", [txn({ id: 1 })], bankAccountsById);
    expect(journalRepo.cancelJournal).toHaveBeenCalledWith("co_1", 500);
    expect(journalRepo.updateJournal).not.toHaveBeenCalled();
    expect(outcome.journal).toBeNull();
    expect(outcome.includedTransactionIds).toEqual([]);
  });

  it("leaves the draft untouched when every link landed", async () => {
    await generateJournalFromTransactions("co_1", [txn({ id: 1 }), txn({ id: 2 })], bankAccountsById);
    expect(journalRepo.updateJournal).not.toHaveBeenCalled();
    expect(journalRepo.cancelJournal).not.toHaveBeenCalled();
  });
});
