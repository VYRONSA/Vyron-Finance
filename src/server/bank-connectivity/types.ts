/**
 * Phase 16, Part 3 — the provider-neutral VYRON bank model. These types
 * describe what a bank CONNECTION looks like (consent/token state,
 * linked accounts, sync history) — they are NOT a second transaction
 * model. A synced transaction is mapped straight into the EXISTING
 * `ParsedBankTransaction` shape (`src/server/import-centre/types.ts`)
 * and committed through the EXISTING ingestion pipeline
 * (`ingestBankTransactionIdempotent`) — see `bank-sync-service.ts`. Only
 * `BankTransactionFeedItem` below is transaction-shaped, and only as
 * the intermediate "what a provider's API returned, before mapping"
 * shape — it never touches the database directly.
 */

export type BankProviderName = "FNB";

export type BankConnectionStatus = "PendingAuthorization" | "Connected" | "Disconnected" | "Error";

/** FINDINGS.md §14 — FNB's public documentation does not mention a
 * sandbox/test environment. "development" here means "this connection
 * was created against VYRON's own dev/staging deployment," never a
 * claim that the BANK provides a test mode. */
export type BankEnvironment = "development" | "production";

export type BankConnection = {
  id: number;
  companyId: string;
  provider: BankProviderName;
  environment: BankEnvironment;
  status: BankConnectionStatus;
  /** Whatever scope string the token response actually returned — never
   * a hand-authored guess (OAuth scope names are not published). */
  grantedScope: string | null;
  tokenExpiresAt: string | null;
  lastHealthCheckAt: string | null;
  lastHealthCheckStatus: "Ok" | "Error" | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  disconnectedAt: string | null;
};

export type BankConnectionAccountStatus = "Active" | "Disconnected";

export type BankConnectionAccount = {
  id: number;
  companyId: string;
  bankConnectionId: number;
  /** The EXISTING `ae_bank_accounts.id` this provider account feeds —
   * never a duplicate/parallel account record. */
  bankAccountId: number;
  providerAccountId: string;
  maskedAccountNumber: string;
  accountHolderName: string;
  currency: string;
  status: BankConnectionAccountStatus;
  lastSyncedThrough: string | null;
  lastSyncStatus: "Success" | "Failed" | "PartialFailure" | null;
  lastSyncAt: string | null;
  lastTransactionReceivedAt: string | null;
  createdAt: string;
};

export type BankSyncType = "Initial" | "Incremental";
export type BankSyncStatus = "Running" | "Success" | "Failed" | "PartialFailure";

export type BankSyncRun = {
  id: number;
  companyId: string;
  bankConnectionAccountId: number;
  syncType: BankSyncType;
  status: BankSyncStatus;
  rangeStart: string;
  rangeEnd: string;
  transactionsFetched: number;
  transactionsImported: number;
  transactionsDuplicate: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

/** A raw balance/transaction fact as returned by a provider's API,
 * before mapping — still in "the provider told us this," not yet "a
 * VYRON bank transaction." */
export type BankTransactionFeedItem = {
  /** The bank's own transaction identifier/reference — preserved
   * verbatim (Part 7 #5) so it can seed the EXISTING dedup key's
   * `reference` field, never regenerated. */
  providerTransactionId: string;
  /** ISO date (YYYY-MM-DD) — a provider's own "value date"/"booking
   * date" distinction, if any, is resolved by the provider's own mapper
   * before this shape exists; VYRON's existing transaction model has
   * exactly one date field. */
  date: string;
  description: string;
  reference: string;
  amount: number;
  /** Whichever the provider itself reports — the mapper turns this into
   * VYRON's existing separate debit/credit columns, never inferring
   * sign from `amount` alone. */
  direction: "debit" | "credit";
  balanceAfter: number | null;
  currency: string;
};

export type BankAccountFeedItem = {
  providerAccountId: string;
  accountHolderName: string;
  maskedAccountNumber: string;
  accountType: string;
  currency: string;
};

export type BankAccountBalanceFeedItem = {
  providerAccountId: string;
  balance: number;
  asOfDate: string;
  currency: string;
};
