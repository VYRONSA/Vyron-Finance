/**
 * Phase 16 — the FNB implementation of `BankProvider`
 * (`../../bank-provider.ts`). Composes `fnb-client.ts` (raw HTTP) and
 * `fnb-mapper.ts` (pure mapping) — this file itself only adapts between
 * VYRON's provider-neutral interface and FNB's own client/mapper calls.
 */

import type { AuthorizationUrlParams, AuthorizedBankSession, BankProvider, BankProviderCapabilities, ExchangeAuthorizationCodeParams, GetTransactionsParams, HealthCheckResult, TokenSet } from "../../bank-provider";
import type { BankAccountBalanceFeedItem, BankAccountFeedItem, BankTransactionFeedItem } from "../../types";
import { buildAuthorizationUrl, exchangeCodeForToken, fetchAccountBalance, fetchAccounts, fetchTransactions, fnbConfig, refreshToken as refreshTokenRequest } from "./fnb-client";
import { mapFnbAccounts, mapFnbBalance, mapFnbTransactions } from "./fnb-mapper";

/** FINDINGS.md §14 — confirmed capabilities of FNB's public Transaction
 * History API. `supportsRealtimeNotifications` is false: the API's own
 * documentation states it "uses polling method"; no push/webhook
 * mechanism is documented for it, and the separate Real Time
 * Notifications API's behaviour could not be confirmed (bot-protected
 * documentation, see FINDINGS.md's own note) — never claimed true on
 * unconfirmed grounds. */
export const FNB_CAPABILITIES: BankProviderCapabilities = {
  supportsOAuthAuthorizationCode: true,
  supportsTokenRefresh: true,
  supportsBalances: true,
  supportsTransactionHistory: true,
  supportsRealtimeNotifications: false,
};

function toTokenSet(raw: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }): TokenSet {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresInSeconds: raw.expires_in,
    grantedScope: raw.scope ?? null,
  };
}

export function createFnbProvider(): BankProvider {
  return {
    name: "FNB",
    capabilities: FNB_CAPABILITIES,

    getAuthorizationUrl(params: AuthorizationUrlParams): string {
      return buildAuthorizationUrl(fnbConfig(), params.state);
    },

    async exchangeAuthorizationCode(params: ExchangeAuthorizationCodeParams): Promise<TokenSet> {
      const raw = await exchangeCodeForToken(fnbConfig(), params.code);
      return toTokenSet(raw);
    },

    async refreshAccessToken(refreshTokenValue: string): Promise<TokenSet> {
      const raw = await refreshTokenRequest(fnbConfig(), refreshTokenValue);
      return toTokenSet(raw);
    },

    async getAccounts(session: AuthorizedBankSession): Promise<BankAccountFeedItem[]> {
      const raw = await fetchAccounts(fnbConfig(), session.accessToken);
      return mapFnbAccounts(raw);
    },

    async getAccountBalance(session: AuthorizedBankSession, providerAccountId: string): Promise<BankAccountBalanceFeedItem> {
      const raw = await fetchAccountBalance(fnbConfig(), session.accessToken, providerAccountId);
      return mapFnbBalance(raw);
    },

    async getTransactions(session: AuthorizedBankSession, params: GetTransactionsParams): Promise<BankTransactionFeedItem[]> {
      const raw = await fetchTransactions(fnbConfig(), session.accessToken, params.providerAccountId, params.rangeStart, params.rangeEnd);
      return mapFnbTransactions(raw).items;
    },

    async disconnect(): Promise<void> {
      // FNB's public documentation does not describe a token-revocation
      // endpoint (FINDINGS.md §15) — VYRON's own side of the connection
      // (bank-connectivity-service.ts::disconnectBankConnection) still
      // marks the connection Disconnected and stops polling regardless;
      // there is nothing further this provider can safely claim to do
      // here without an undocumented endpoint.
    },

    async healthCheck(session: AuthorizedBankSession): Promise<HealthCheckResult> {
      try {
        await fetchAccounts(fnbConfig(), session.accessToken);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Unknown FNB health check error." };
      }
    },
  };
}
