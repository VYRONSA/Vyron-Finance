import { describe, expect, it } from "vitest";
import { buildJournalLinesForSplitTransaction, buildJournalLinesForTransaction, generateJournalDraft, resolveBankGlAccount } from "./journal-service";
import type { BankTransactionRecord } from "@/server/accounting/types";

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
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
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
      null,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a single split line", () => {
    const result = buildJournalLinesForSplitTransaction(txn({ debit: 500, credit: 0 }), [{ amount: 500, description: "a", glAccount: "6300" }], null);
    expect(result.ok).toBe(false);
  });

  it("rejects an already-journaled transaction", () => {
    const result = buildJournalLinesForSplitTransaction(
      txn({ debit: 500, credit: 0, journalId: 99 }),
      [
        { amount: 300, description: "a", glAccount: "6300" },
        { amount: 200, description: "b", glAccount: "6400" },
      ],
      null,
    );
    expect(result.ok).toBe(false);
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

  it("falls back to a synthetic bank GL code when the bank account has none configured", () => {
    const result = buildJournalLinesForTransaction(txn({ debit: 500 }), { glAccount: "", accountNumber: "62050837304" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.lines[1].accountCode).toBe("BANK-62050837304");
  });
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
