import { describe, expect, it } from "vitest";
import { FnbMappingError, mapFnbAccounts, mapFnbBalance, mapFnbTransactions } from "./fnb-mapper";

describe("mapFnbAccounts (normalised mapping)", () => {
  it("maps a well-formed accounts response", () => {
    const result = mapFnbAccounts({ accounts: [{ accountId: "acc-1", accountHolderName: "Acme Ltd", accountNumberMasked: "•••• 1234", accountType: "Cheque", currency: "ZAR" }] });
    expect(result).toEqual([{ providerAccountId: "acc-1", accountHolderName: "Acme Ltd", maskedAccountNumber: "•••• 1234", accountType: "Cheque", currency: "ZAR" }]);
  });

  it("skips a malformed account row rather than throwing (malformed response handling)", () => {
    const result = mapFnbAccounts({ accounts: [{ accountId: "acc-1", currency: "ZAR" }, { currency: "ZAR" }] });
    expect(result).toEqual([{ providerAccountId: "acc-1", accountHolderName: "", maskedAccountNumber: "", accountType: "", currency: "ZAR" }]);
  });

  it("throws FnbMappingError for a wholly malformed top-level response (malformed response handling)", () => {
    expect(() => mapFnbAccounts({})).toThrow(FnbMappingError);
    expect(() => mapFnbAccounts(null)).toThrow(FnbMappingError);
    expect(() => mapFnbAccounts("not json")).toThrow(FnbMappingError);
  });

  it("returns an empty list for an empty accounts array (empty data)", () => {
    expect(mapFnbAccounts({ accounts: [] })).toEqual([]);
  });
});

describe("mapFnbBalance (balance mapping)", () => {
  it("maps a well-formed balance response", () => {
    const result = mapFnbBalance({ accountId: "acc-1", balance: 15420.55, currency: "ZAR", asOfDate: "2026-08-11" });
    expect(result).toEqual({ providerAccountId: "acc-1", balance: 15420.55, asOfDate: "2026-08-11", currency: "ZAR" });
  });

  it("maps a negative balance without altering its sign", () => {
    const result = mapFnbBalance({ accountId: "acc-1", balance: -500, currency: "ZAR", asOfDate: "2026-08-11" });
    expect(result.balance).toBe(-500);
  });

  it("throws FnbMappingError when a required field is missing (malformed response handling)", () => {
    expect(() => mapFnbBalance({ accountId: "acc-1", currency: "ZAR", asOfDate: "2026-08-11" })).toThrow(FnbMappingError);
    expect(() => mapFnbBalance(null)).toThrow(FnbMappingError);
  });
});

describe("mapFnbTransactions (transaction response mapping)", () => {
  it("maps a well-formed transaction list, preserving the bank's own transaction ID (bank transaction ID preservation)", () => {
    const result = mapFnbTransactions({
      accountId: "acc-1",
      transactions: [
        { transactionId: "FNB-TXN-000123", valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "POS Purchase", reference: "REF001", amount: 250.5, currency: "ZAR", debitCreditIndicator: "DEBIT", balance: 14500 },
      ],
    });
    expect(result.skipped).toBe(0);
    expect(result.items).toEqual([{ providerTransactionId: "FNB-TXN-000123", date: "2026-08-10", description: "POS Purchase", reference: "REF001", amount: 250.5, direction: "debit", balanceAfter: 14500, currency: "ZAR" }]);
  });

  it("maps debit/credit correctly from the explicit indicator, never inferring sign from amount (debit/credit mapping)", () => {
    const result = mapFnbTransactions({
      accountId: "acc-1",
      transactions: [
        { transactionId: "t1", valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "Debit", reference: "r1", amount: -100, currency: "ZAR", debitCreditIndicator: "DEBIT", balance: null },
        { transactionId: "t2", valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "Credit", reference: "r2", amount: 100, currency: "ZAR", debitCreditIndicator: "CREDIT", balance: null },
      ],
    });
    expect(result.items[0]).toMatchObject({ direction: "debit", amount: 100 });
    expect(result.items[1]).toMatchObject({ direction: "credit", amount: 100 });
  });

  it("takes the absolute value of amount regardless of the sign FNB happened to send", () => {
    const result = mapFnbTransactions({ accountId: "acc-1", transactions: [{ transactionId: "t1", valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "d", reference: "r", amount: -75.25, currency: "ZAR", debitCreditIndicator: "DEBIT", balance: null }] });
    expect(result.items[0].amount).toBe(75.25);
  });

  it("truncates a full ISO timestamp valueDate down to a plain date (date range mapping)", () => {
    const result = mapFnbTransactions({ accountId: "acc-1", transactions: [{ transactionId: "t1", valueDate: "2026-08-10T14:23:00.000Z", bookingDate: "2026-08-10", transactionDetails: "d", reference: "r", amount: 10, currency: "ZAR", debitCreditIndicator: "CREDIT", balance: null }] });
    expect(result.items[0].date).toBe("2026-08-10");
  });

  it("skips an individual malformed transaction row and counts it, without dropping the valid rows around it (malformed response handling)", () => {
    const result = mapFnbTransactions({
      accountId: "acc-1",
      transactions: [
        { transactionId: "t1", valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "Good row", reference: "r1", amount: 10, currency: "ZAR", debitCreditIndicator: "CREDIT", balance: null },
        { transactionId: "t2", valueDate: "not-a-date", bookingDate: "2026-08-10", transactionDetails: "Bad date", reference: "r2", amount: 10, currency: "ZAR", debitCreditIndicator: "CREDIT", balance: null },
        { valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "Missing id", reference: "r3", amount: 10, currency: "ZAR", debitCreditIndicator: "CREDIT", balance: null },
        { transactionId: "t4", valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "Bad indicator", reference: "r4", amount: 10, currency: "ZAR", debitCreditIndicator: "SOMETHING_ELSE", balance: null },
        { transactionId: "t5", valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "Good row 2", reference: "r5", amount: 20, currency: "ZAR", debitCreditIndicator: "DEBIT", balance: null },
      ],
    });
    expect(result.items.map((i) => i.providerTransactionId)).toEqual(["t1", "t5"]);
    expect(result.skipped).toBe(3);
  });

  it("throws FnbMappingError for a wholly malformed top-level response (malformed response handling)", () => {
    expect(() => mapFnbTransactions({})).toThrow(FnbMappingError);
    expect(() => mapFnbTransactions(undefined)).toThrow(FnbMappingError);
  });

  it("returns an empty items list for an empty transactions array (empty data)", () => {
    const result = mapFnbTransactions({ accountId: "acc-1", transactions: [] });
    expect(result.items).toEqual([]);
    expect(result.skipped).toBe(0);
  });

  it("defaults currency to ZAR when FNB omits it, never fabricating an unrelated currency", () => {
    const result = mapFnbTransactions({ accountId: "acc-1", transactions: [{ transactionId: "t1", valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "d", reference: "r", amount: 10, debitCreditIndicator: "CREDIT", balance: null }] });
    expect(result.items[0].currency).toBe("ZAR");
  });
});
