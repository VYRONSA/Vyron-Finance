/**
 * Phase 16 — pure mapping between FNB's wire shapes (`fnb-types.ts`) and
 * VYRON's own normalised bank feed types (`../../types.ts`), plus the
 * final mapping into the EXISTING ingestion shape,
 * `ParsedBankTransaction` (`src/server/import-centre/types.ts`). No I/O,
 * no fetch calls — everything here is synchronous and independently
 * testable against fixture JSON, mirroring how every existing bank
 * statement parser in this codebase is structured.
 */

import type { BankAccountBalanceFeedItem, BankAccountFeedItem, BankTransactionFeedItem } from "../../types";
import type { FnbAccount, FnbAccountsResponse, FnbBalanceResponse, FnbTransaction, FnbTransactionsResponse } from "./fnb-types";

export class FnbMappingError extends Error {}

function isFnbAccount(value: unknown): value is FnbAccount {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.accountId === "string" && v.accountId.length > 0 && typeof v.currency === "string";
}

export function mapFnbAccounts(response: unknown): BankAccountFeedItem[] {
  if (!response || typeof response !== "object" || !Array.isArray((response as FnbAccountsResponse).accounts)) {
    throw new FnbMappingError("FNB accounts response was not in the expected shape (missing 'accounts' array).");
  }
  const { accounts } = response as FnbAccountsResponse;
  return accounts.filter(isFnbAccount).map((a) => ({
    providerAccountId: a.accountId,
    accountHolderName: a.accountHolderName ?? "",
    maskedAccountNumber: a.accountNumberMasked ?? "",
    accountType: a.accountType ?? "",
    currency: a.currency,
  }));
}

export function mapFnbBalance(response: unknown): BankAccountBalanceFeedItem {
  if (!response || typeof response !== "object") {
    throw new FnbMappingError("FNB balance response was not in the expected shape.");
  }
  const v = response as FnbBalanceResponse;
  if (typeof v.accountId !== "string" || typeof v.balance !== "number" || typeof v.currency !== "string" || typeof v.asOfDate !== "string") {
    throw new FnbMappingError("FNB balance response is missing required fields (accountId/balance/currency/asOfDate).");
  }
  return { providerAccountId: v.accountId, balance: v.balance, asOfDate: v.asOfDate, currency: v.currency };
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isMappableFnbTransaction(value: unknown): value is FnbTransaction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.transactionId === "string" &&
    v.transactionId.length > 0 &&
    isValidIsoDate(v.valueDate) &&
    typeof v.amount === "number" &&
    !Number.isNaN(v.amount) &&
    (v.debitCreditIndicator === "DEBIT" || v.debitCreditIndicator === "CREDIT")
  );
}

export type MapFnbTransactionsResult = {
  items: BankTransactionFeedItem[];
  /** Individual rows present in the response but missing a required
   * field (malformed response handling) — skipped rather than crashing
   * the whole sync, the same "quarantine the bad row, keep the good
   * ones" discipline every existing statement parser already follows. */
  skipped: number;
};

/** Debit/credit mapping (Part 13's own required test coverage):
 * `debitCreditIndicator` is FNB's own explicit sign — `amount` is never
 * used to INFER the sign, only to supply the magnitude, since a
 * provider's own sign convention on `amount` itself is not documented. */
export function mapFnbTransactions(response: unknown): MapFnbTransactionsResult {
  if (!response || typeof response !== "object" || !Array.isArray((response as FnbTransactionsResponse).transactions)) {
    throw new FnbMappingError("FNB transactions response was not in the expected shape (missing 'transactions' array).");
  }
  const { transactions } = response as FnbTransactionsResponse;

  const items: BankTransactionFeedItem[] = [];
  let skipped = 0;
  for (const raw of transactions) {
    if (!isMappableFnbTransaction(raw)) {
      skipped++;
      continue;
    }
    items.push({
      providerTransactionId: raw.transactionId,
      date: raw.valueDate.slice(0, 10),
      description: raw.transactionDetails ?? "",
      reference: raw.reference ?? "",
      amount: Math.abs(raw.amount),
      direction: raw.debitCreditIndicator === "DEBIT" ? "debit" : "credit",
      balanceAfter: typeof raw.balance === "number" ? raw.balance : null,
      currency: raw.currency ?? "ZAR",
    });
  }
  return { items, skipped };
}
