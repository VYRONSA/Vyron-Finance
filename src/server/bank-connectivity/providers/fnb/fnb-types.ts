/**
 * Phase 16 — FNB Transaction History API wire types.
 *
 * IMPORTANT: FNB's public catalogue page (FINDINGS.md §14) documents
 * the DATA FIELDS the API returns/accepts (transaction ID, value date,
 * booking date, transaction details, reference, amount, currency,
 * debit/credit indicator, balances; account balances for a date range;
 * OAuth 2.0 authorization-code tokens) but does NOT publish the exact
 * JSON field names, request/response envelope, or endpoint paths — those
 * are only available via FNB's OpenAPI Specification, given out during
 * developer onboarding (FINDINGS.md §15). The shapes below use the most
 * defensible, conventional field names for the documented data, and are
 * explicitly a best-effort placeholder for `fnb-mapper.ts` to consume —
 * `fnb-client.ts`/`fnb-mapper.ts` must be revisited against the real OAS
 * once it's available. Nothing here is presented as a confirmed contract.
 */

export type FnbTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

export type FnbAccount = {
  accountId: string;
  accountHolderName: string;
  accountNumberMasked: string;
  accountType: string;
  currency: string;
};

export type FnbAccountsResponse = {
  accounts: FnbAccount[];
};

export type FnbBalance = {
  accountId: string;
  balance: number;
  currency: string;
  asOfDate: string;
};

export type FnbBalanceResponse = FnbBalance;

/** One row of FNB's documented transaction-history fields. */
export type FnbTransaction = {
  transactionId: string;
  valueDate: string;
  bookingDate: string;
  transactionDetails: string;
  reference: string;
  amount: number;
  currency: string;
  debitCreditIndicator: "DEBIT" | "CREDIT";
  balance: number | null;
};

export type FnbTransactionsResponse = {
  accountId: string;
  transactions: FnbTransaction[];
};

export type FnbErrorResponse = {
  error: string;
  error_description?: string;
};
