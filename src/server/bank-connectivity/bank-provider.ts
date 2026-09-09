/**
 * Phase 16, Part 2 — the provider-independent bank connectivity
 * abstraction. The accounting engine (import ingestion, dedup, banking
 * rules, matching, reconciliation, financial intelligence) NEVER depends
 * on this file or on FNB directly — it only ever sees the output after
 * `bank-sync-service.ts` has mapped a provider's data into the EXISTING
 * `ParsedBankTransaction` shape. This file is the seam a second provider
 * would implement against.
 *
 * Capability flags (`BankProviderCapabilities`) exist because a real
 * provider may not support every operation — FNB's own documented API
 * (FINDINGS.md §14) supports polling only, no push notifications, so
 * `supportsRealtimeNotifications` is false today; a provider must never
 * be called for an operation its own capabilities say it doesn't
 * support (`bank-connectivity-service.ts`/`bank-sync-service.ts` check
 * this before calling).
 */

import type { BankAccountBalanceFeedItem, BankAccountFeedItem, BankTransactionFeedItem } from "./types";

export type BankProviderCapabilities = {
  /** OAuth 2.0 authorization-code flow, per FINDINGS.md §14. */
  supportsOAuthAuthorizationCode: boolean;
  supportsTokenRefresh: boolean;
  supportsBalances: boolean;
  supportsTransactionHistory: boolean;
  /** Polling only, confirmed by FNB's own documentation — never claim
   * true for a provider whose docs don't confirm a push mechanism. */
  supportsRealtimeNotifications: boolean;
};

export type AuthorizationUrlParams = {
  /** The CSRF-protection state token (`bank_oauth_states.state`) —
   * minted and persisted by the caller, never by the provider. */
  state: string;
};

export type ExchangeAuthorizationCodeParams = {
  code: string;
};

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds until expiry, as returned by the token endpoint — the
   * caller computes an absolute `token_expires_at` from this plus "now",
   * never assumes a fixed lifetime. */
  expiresInSeconds: number;
  /** The token response's own `scope` field, verbatim. */
  grantedScope: string | null;
};

export type HealthCheckResult = { ok: true } | { ok: false; message: string };

export type GetTransactionsParams = {
  providerAccountId: string;
  /** Inclusive ISO date range — FNB's own documented "defined account
   * and date range" parameter (FINDINGS.md §14). */
  rangeStart: string;
  rangeEnd: string;
};

/**
 * A live, authenticated session against one connection's tokens.
 * Returned by the provider so a caller never has to pass a raw
 * access/refresh token string around outside `bank-connectivity-service.ts`
 * — everywhere else in the sync pipeline holds only this handle.
 */
export type AuthorizedBankSession = {
  accessToken: string;
};

export interface BankProvider {
  readonly name: "FNB";
  readonly capabilities: BankProviderCapabilities;

  /** Builds the real FNB authorization URL the user's browser is
   * redirected to. Never called if `capabilities.supportsOAuthAuthorizationCode`
   * is false. */
  getAuthorizationUrl(params: AuthorizationUrlParams): string;

  /** Server-side exchange of the authorization code FNB returned to the
   * callback route for a real token set. Never called from the browser. */
  exchangeAuthorizationCode(params: ExchangeAuthorizationCodeParams): Promise<TokenSet>;

  /** Never called unless `capabilities.supportsTokenRefresh` is true. */
  refreshAccessToken(refreshToken: string): Promise<TokenSet>;

  /** Not gated by a capability flag — listing the accounts a connection
   * was authorized for is assumed available on any provider that
   * supports the authorization-code flow at all. */
  getAccounts(session: AuthorizedBankSession): Promise<BankAccountFeedItem[]>;

  /** Never called unless `capabilities.supportsBalances` is true. */
  getAccountBalance(session: AuthorizedBankSession, providerAccountId: string): Promise<BankAccountBalanceFeedItem>;

  /** Never called unless `capabilities.supportsTransactionHistory` is
   * true. Returns raw feed items — mapping into VYRON's existing
   * transaction shape happens in the provider's own mapper module,
   * called by `bank-sync-service.ts`, never here. */
  getTransactions(session: AuthorizedBankSession, params: GetTransactionsParams): Promise<BankTransactionFeedItem[]>;

  /** Revokes VYRON's own record of the connection. Does not claim to
   * revoke the grant at FNB's end unless FNB's API documents a
   * revocation endpoint (FINDINGS.md — not confirmed); the connection's
   * `status` is set to `Disconnected` and its tokens are cleared either
   * way, so VYRON stops polling regardless. */
  disconnect(session: AuthorizedBankSession): Promise<void>;

  /** A cheap, real call that proves the current tokens still work —
   * used by the Connected Banks UI's "Connection status" and by the
   * scheduler before a sync attempt. Never fabricates "Ok". */
  healthCheck(session: AuthorizedBankSession): Promise<HealthCheckResult>;
}
