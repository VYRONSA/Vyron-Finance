/**
 * Phase 16, Part 6 — the OAuth 2.0 authorization-code flow orchestration
 * (connect / callback / list-and-link accounts / disconnect / health
 * check). This is the ONLY module allowed to decrypt a stored token —
 * everywhere else (routes, `bank-sync-service.ts`) only ever holds the
 * `AuthorizedBankSession` handle this module hands back.
 *
 * Flow (brief, Part 6), each arrow below is one exported function:
 *   Connect Bank -> initiateBankConnection (generates state, returns FNB's real authorization URL)
 *   [customer authenticates/consents at FNB — VYRON never sees credentials]
 *   FNB redirects to VYRON callback -> completeBankConnectionAuthorization (exchanges code server-side, stores encrypted tokens)
 *   Accounts retrieved -> listProviderAccounts
 *   Customer selects/links accounts -> linkBankConnectionAccount
 *   [bank-sync-service.ts performs the initial sync from here]
 */

import { randomBytes } from "node:crypto";
import * as repo from "@/server/repositories/bank-connectivity-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import { createFnbProvider } from "./providers/fnb/fnb-provider";
import { decryptToken, encryptToken } from "./token-encryption";
import type { BankProvider, AuthorizedBankSession } from "./bank-provider";
import type { BankAccountFeedItem, BankConnection, BankConnectionAccount, BankEnvironment, BankProviderName } from "./types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const STATE_TTL_MS = 15 * 60_000;

function getProvider(name: BankProviderName): BankProvider {
  if (name === "FNB") return createFnbProvider();
  throw new ValidationError(`Unsupported bank provider: ${name}`);
}

function generateState(): string {
  return randomBytes(32).toString("base64url");
}

export type InitiateConnectionResult = { connection: BankConnection; authorizationUrl: string };

export async function initiateBankConnection(companyId: string, provider: BankProviderName, environment: BankEnvironment, nowIso: string, redirectAfter: string | null = null): Promise<InitiateConnectionResult> {
  const providerImpl = getProvider(provider);
  if (!providerImpl.capabilities.supportsOAuthAuthorizationCode) {
    throw new ValidationError(`${provider} does not support the OAuth authorization-code flow.`);
  }

  const connection = await repo.createPendingBankConnection(companyId, { provider, environment });
  const state = generateState();
  const expiresAt = new Date(Date.parse(nowIso) + STATE_TTL_MS).toISOString();
  await repo.createOAuthState(state, companyId, provider, connection.id, expiresAt, redirectAfter);

  return { connection, authorizationUrl: providerImpl.getAuthorizationUrl({ state }) };
}

export type CompleteAuthorizationResult = { companyId: string; connection: BankConnection; redirectAfter: string | null };

/**
 * Called by the (top-level, not company-scoped — see the route's own
 * comment for why) OAuth callback route. `state` is the ONLY thing tying
 * this request back to a real company and a real pending connection —
 * `repo.consumeOAuthState` is single-use and rejects anything
 * missing/already-consumed/expired, which is the actual CSRF defense
 * (brief, Part 6: "Use state protection against CSRF").
 */
export async function completeBankConnectionAuthorization(state: string, code: string, nowIso: string): Promise<CompleteAuthorizationResult> {
  const stateRow = await repo.consumeOAuthState(state, nowIso);
  if (!stateRow) throw new ValidationError("This authorization link is invalid, has expired, or was already used. Please reconnect your bank.");

  const providerImpl = getProvider(stateRow.provider as BankProviderName);
  let tokenSet;
  try {
    tokenSet = await providerImpl.exchangeAuthorizationCode({ code });
  } catch (error) {
    await repo.markBankConnectionError(stateRow.company_id, stateRow.bank_connection_id, error instanceof Error ? error.message : "Token exchange failed.", nowIso);
    throw error;
  }

  const connection = await repo.markBankConnectionAuthorized(stateRow.company_id, stateRow.bank_connection_id, {
    accessTokenEncrypted: encryptToken(tokenSet.accessToken),
    refreshTokenEncrypted: tokenSet.refreshToken ? encryptToken(tokenSet.refreshToken) : null,
    tokenExpiresAt: new Date(Date.parse(nowIso) + tokenSet.expiresInSeconds * 1000).toISOString(),
    grantedScope: tokenSet.grantedScope,
  });

  return { companyId: stateRow.company_id, connection, redirectAfter: stateRow.redirect_after };
}

/**
 * Resolves a live, authenticated session for a connection — refreshing
 * the access token first if it has expired and the provider supports
 * refresh (brief, Part 8: "refresh authorisation if required"). This is
 * the ONLY place a token is decrypted for outbound use; the caller
 * (`bank-sync-service.ts`, `healthCheckConnection` below) only ever
 * receives the resulting `AuthorizedBankSession`.
 */
export async function getAuthorizedSession(companyId: string, connection: BankConnection, nowIso: string): Promise<AuthorizedBankSession> {
  if (connection.status !== "Connected") {
    throw new ValidationError(`Bank connection ${connection.id} is not Connected (status: ${connection.status}).`);
  }
  const providerImpl = getProvider(connection.provider);

  const row = await repo.getBankConnection(companyId, connection.id);
  if (!row) throw new NotFoundError(`No bank connection with id ${connection.id}.`);

  const needsRefresh = row.tokenExpiresAt !== null && row.tokenExpiresAt < nowIso;
  if (needsRefresh) {
    if (!providerImpl.capabilities.supportsTokenRefresh) {
      throw new ValidationError(`${connection.provider}'s access token has expired and this provider does not support refresh — the customer must reconnect.`);
    }
    // Re-read the encrypted refresh token directly (never held longer
    // than this function call).
    const encryptedRefreshToken = await repo.getRefreshTokenEncrypted(companyId, connection.id);
    if (!encryptedRefreshToken) throw new ValidationError("No refresh token is on file for this connection — the customer must reconnect.");
    const tokenSet = await providerImpl.refreshAccessToken(decryptToken(encryptedRefreshToken));
    await repo.updateBankConnectionTokens(companyId, connection.id, {
      accessTokenEncrypted: encryptToken(tokenSet.accessToken),
      refreshTokenEncrypted: tokenSet.refreshToken ? encryptToken(tokenSet.refreshToken) : encryptedRefreshToken,
      tokenExpiresAt: new Date(Date.parse(nowIso) + tokenSet.expiresInSeconds * 1000).toISOString(),
      grantedScope: tokenSet.grantedScope,
    });
    return { accessToken: tokenSet.accessToken };
  }

  const encryptedAccessToken = await repo.getAccessTokenEncrypted(companyId, connection.id);
  if (!encryptedAccessToken) throw new ValidationError("No access token is on file for this connection.");
  return { accessToken: decryptToken(encryptedAccessToken) };
}

export async function listProviderAccounts(companyId: string, connectionId: number, nowIso: string): Promise<BankAccountFeedItem[]> {
  const connection = await repo.getBankConnection(companyId, connectionId);
  if (!connection) throw new NotFoundError(`No bank connection with id ${connectionId}.`);
  const providerImpl = getProvider(connection.provider);
  const session = await getAuthorizedSession(companyId, connection, nowIso);
  return providerImpl.getAccounts(session);
}

export type LinkAccountInput = {
  connectionId: number;
  providerAccountId: string;
  accountHolderName: string;
  maskedAccountNumber: string;
  currency: string;
  /** Either an existing VYRON bank account to feed, or the fields to
   * create a new one — mirrors the same "resolve or create" choice the
   * manual "Add Bank Account" flow already offers, never auto-created
   * silently the way an unrecognised statement account number is
   * (that auto-create-on-unknown-number convenience makes sense for a
   * one-off import; for a bank-authorized connection the customer has
   * already explicitly picked/consented to the account, so they confirm
   * the VYRON-side mapping explicitly too). */
  targetBankAccountId: number | null;
  newBankAccountName: string | null;
};

export async function linkBankConnectionAccount(companyId: string, input: LinkAccountInput): Promise<BankConnectionAccount> {
  const connection = await repo.getBankConnection(companyId, input.connectionId);
  if (!connection) throw new NotFoundError(`No bank connection with id ${input.connectionId}.`);

  let bankAccountId = input.targetBankAccountId;
  if (!bankAccountId) {
    if (!input.newBankAccountName) throw new ValidationError("Either targetBankAccountId or newBankAccountName is required.");
    const created = await bankAccountRepo.createBankAccount(companyId, {
      accountNumber: input.maskedAccountNumber || input.providerAccountId,
      accountName: input.newBankAccountName,
      bankName: "FNB",
      accountType: "",
      branch: "",
      currency: input.currency,
      openingBalance: 0,
      openingBalanceDate: null,
      openingBalanceReference: "",
      glAccount: "",
    });
    bankAccountId = created.id;
  } else {
    const targetAccount = await bankAccountRepo.getBankAccount(companyId, bankAccountId);
    if (!targetAccount) throw new NotFoundError(`No bank account with id ${bankAccountId}.`);
  }

  return repo.linkBankConnectionAccount(companyId, {
    bankConnectionId: input.connectionId,
    bankAccountId,
    providerAccountId: input.providerAccountId,
    maskedAccountNumber: input.maskedAccountNumber,
    accountHolderName: input.accountHolderName,
    currency: input.currency,
  });
}

export async function disconnectBankConnection(companyId: string, connectionId: number, nowIso: string): Promise<void> {
  const connection = await repo.getBankConnection(companyId, connectionId);
  if (!connection) throw new NotFoundError(`No bank connection with id ${connectionId}.`);
  if (connection.status === "Connected") {
    const providerImpl = getProvider(connection.provider);
    try {
      const session = await getAuthorizedSession(companyId, connection, nowIso);
      await providerImpl.disconnect(session);
    } catch {
      // Disconnecting VYRON's own record must succeed even if the
      // provider-side call fails (e.g. token already expired) — see
      // fnb-provider.ts::disconnect's own note on why there's nothing
      // further to safely call anyway.
    }
  }
  await repo.disconnectBankConnection(companyId, connectionId, nowIso);
}

export type HealthCheckOutcome = { ok: boolean; message: string | null };

export async function healthCheckConnection(companyId: string, connectionId: number, nowIso: string): Promise<HealthCheckOutcome> {
  const connection = await repo.getBankConnection(companyId, connectionId);
  if (!connection) throw new NotFoundError(`No bank connection with id ${connectionId}.`);
  const providerImpl = getProvider(connection.provider);
  try {
    const session = await getAuthorizedSession(companyId, connection, nowIso);
    const result = await providerImpl.healthCheck(session);
    await repo.recordBankConnectionHealthCheck(companyId, connectionId, result.ok ? "Ok" : "Error", result.ok ? null : result.message, nowIso);
    return result.ok ? { ok: true, message: null } : { ok: false, message: result.message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown health check error.";
    await repo.recordBankConnectionHealthCheck(companyId, connectionId, "Error", message, nowIso);
    return { ok: false, message };
  }
}

export const listBankConnections = repo.listBankConnections;
export const listBankConnectionAccounts = repo.listBankConnectionAccounts;
export const getBankConnection = repo.getBankConnection;

/** Phase 16, Part 9 — the ONE read the Connected Banks card needs. Real
 * data only: a connection with no linked accounts yet shows zero rows,
 * never a placeholder row (brief, Part 12: never fabricate a connected
 * account). Balance/account-name come from the EXISTING `ae_bank_accounts`
 * row each linked account feeds — never a second, parallel balance
 * figure. */
export type ConnectedBankDisplayRow = {
  connection: BankConnection;
  linkedAccount: BankConnectionAccount;
  bankAccountName: string;
  currentBalance: number;
  currency: string;
};

export async function listConnectedBanksForDisplay(companyId: string): Promise<ConnectedBankDisplayRow[]> {
  const connections = await repo.listBankConnections(companyId);
  const rows: ConnectedBankDisplayRow[] = [];
  for (const connection of connections) {
    const linkedAccounts = await repo.listBankConnectionAccounts(companyId, connection.id);
    for (const linkedAccount of linkedAccounts) {
      const bankAccount = await bankAccountRepo.getBankAccount(companyId, linkedAccount.bankAccountId);
      rows.push({
        connection,
        linkedAccount,
        bankAccountName: bankAccount?.accountName ?? linkedAccount.accountHolderName,
        currentBalance: bankAccount?.currentBalance ?? 0,
        currency: bankAccount?.currency ?? linkedAccount.currency,
      });
    }
  }
  return rows;
}
