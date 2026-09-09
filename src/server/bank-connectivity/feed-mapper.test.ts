import { describe, expect, it } from "vitest";
import { toParsedBankTransaction } from "./feed-mapper";
import type { BankTransactionFeedItem } from "./types";

function feedItem(overrides: Partial<BankTransactionFeedItem> = {}): BankTransactionFeedItem {
  return {
    providerTransactionId: "FNB-TXN-000123",
    date: "2026-08-10",
    description: "POS Purchase",
    reference: "REF001",
    amount: 250.5,
    direction: "debit",
    balanceAfter: 14500,
    currency: "ZAR",
    ...overrides,
  };
}

describe("toParsedBankTransaction (normalised mapping into the EXISTING ingestion shape)", () => {
  it("maps every real field into ParsedBankTransaction", () => {
    const result = toParsedBankTransaction(feedItem(), "62812345678", "FNB-SYNC-1-20260811", "FNB Direct Feed", 1);
    expect(result).toEqual({
      transactionDate: "2026-08-10",
      reference: "FNB-TXN-000123",
      description: "POS Purchase",
      beneficiary: "REF001",
      debit: 250.5,
      credit: 0,
      balance: 14500,
      bankAccount: "62812345678",
      vat: null,
      glAccount: "",
      notes: "",
      sourceFilename: "FNB Direct Feed",
      importBatch: "FNB-SYNC-1-20260811",
      rowNumber: 1,
    });
  });

  it("puts a debit amount in the debit column and zero in credit (debit/credit mapping)", () => {
    const result = toParsedBankTransaction(feedItem({ direction: "debit", amount: 100 }), "123", "batch", "src", 1);
    expect(result.debit).toBe(100);
    expect(result.credit).toBe(0);
  });

  it("puts a credit amount in the credit column and zero in debit (debit/credit mapping)", () => {
    const result = toParsedBankTransaction(feedItem({ direction: "credit", amount: 100 }), "123", "batch", "src", 1);
    expect(result.credit).toBe(100);
    expect(result.debit).toBe(0);
  });

  it("preserves the provider's own transaction ID as the reference — the same field the EXISTING dedup key uses (bank transaction ID preservation)", () => {
    const result = toParsedBankTransaction(feedItem({ providerTransactionId: "FNB-UNIQUE-ID-999" }), "123", "batch", "src", 1);
    expect(result.reference).toBe("FNB-UNIQUE-ID-999");
  });

  it("falls back to the feed item's own reference as the description when FNB sends no transaction details", () => {
    const result = toParsedBankTransaction(feedItem({ description: "", reference: "SALARY-AUG" }), "123", "batch", "src", 1);
    expect(result.description).toBe("SALARY-AUG");
  });

  it("passes a null balance through honestly rather than fabricating one", () => {
    const result = toParsedBankTransaction(feedItem({ balanceAfter: null }), "123", "batch", "src", 1);
    expect(result.balance).toBeNull();
  });

  it("never invents VAT or a GL account for a bank-fed transaction — left for the EXISTING Banking Rules/allocation flow", () => {
    const result = toParsedBankTransaction(feedItem(), "123", "batch", "src", 1);
    expect(result.vat).toBeNull();
    expect(result.glAccount).toBe("");
  });
});
