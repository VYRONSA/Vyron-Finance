import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/bank-connectivity-repository", () => ({
  createOAuthState: vi.fn(),
  consumeOAuthState: vi.fn(),
  createPendingBankConnection: vi.fn(),
  markBankConnectionAuthorized: vi.fn(),
  updateBankConnectionTokens: vi.fn(),
  getBankConnection: vi.fn(),
  disconnectBankConnection: vi.fn(),
  recordBankConnectionHealthCheck: vi.fn(),
  markBankConnectionError: vi.fn(),
  getAccessTokenEncrypted: vi.fn(),
  getRefreshTokenEncrypted: vi.fn(),
  linkBankConnectionAccount: vi.fn(),
  listBankConnections: vi.fn(),
  listBankConnectionAccounts: vi.fn(),
}));
vi.mock("@/server/repositories/bank-account-repository", () => ({ createBankAccount: vi.fn(), getBankAccount: vi.fn() }));
vi.mock("./providers/fnb/fnb-provider", () => ({ createFnbProvider: vi.fn() }));

import {
  completeBankConnectionAuthorization,
  disconnectBankConnection,
  getAuthorizedSession,
  healthCheckConnection,
  initiateBankConnection,
  linkBankConnectionAccount,
  listProviderAccounts,
  NotFoundError,
  ValidationError,
} from "./bank-connectivity-service";
import * as connectivityRepo from "@/server/repositories/bank-connectivity-repository";
import * as bankAccountRepo from "@/server/repositories/bank-account-repository";
import { createFnbProvider } from "./providers/fnb/fnb-provider";
import { encryptToken } from "./token-encryption";
import type { BankConnection } from "./types";
import type { BankProvider } from "./bank-provider";

const NOW = "2026-08-11T10:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BANK_TOKEN_ENCRYPTION_KEY = "test-only-key";
});

function connection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: 1,
    companyId: "co_1",
    provider: "FNB",
    environment: "production",
    status: "Connected",
    grantedScope: "accounts",
    tokenExpiresAt: "2026-12-31T00:00:00.000Z",
    lastHealthCheckAt: null,
    lastHealthCheckStatus: null,
    lastErrorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
    disconnectedAt: null,
    ...overrides,
  };
}

function fakeProvider(overrides: Partial<BankProvider> = {}): BankProvider {
  return {
    name: "FNB",
    capabilities: { supportsOAuthAuthorizationCode: true, supportsTokenRefresh: true, supportsBalances: true, supportsTransactionHistory: true, supportsRealtimeNotifications: false },
    getAuthorizationUrl: vi.fn().mockReturnValue("https://fnb.example/oauth/authorize?state=xyz"),
    exchangeAuthorizationCode: vi.fn(),
    refreshAccessToken: vi.fn(),
    getAccounts: vi.fn(),
    getAccountBalance: vi.fn(),
    getTransactions: vi.fn(),
    disconnect: vi.fn(),
    healthCheck: vi.fn(),
    ...overrides,
  };
}

describe("initiateBankConnection", () => {
  it("creates a pending connection, a real random state, and returns FNB's real authorization URL", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider());
    vi.mocked(connectivityRepo.createPendingBankConnection).mockResolvedValue(connection({ status: "PendingAuthorization" }));

    const result = await initiateBankConnection("co_1", "FNB", "production", NOW);

    expect(connectivityRepo.createPendingBankConnection).toHaveBeenCalledWith("co_1", { provider: "FNB", environment: "production" });
    expect(connectivityRepo.createOAuthState).toHaveBeenCalledTimes(1);
    const [state, companyId, provider, connectionId] = vi.mocked(connectivityRepo.createOAuthState).mock.calls[0];
    expect(companyId).toBe("co_1");
    expect(provider).toBe("FNB");
    expect(connectionId).toBe(1);
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(20);
    expect(result.authorizationUrl).toContain("fnb.example");
  });

  it("generates a different state on every call (CSRF protection)", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider());
    vi.mocked(connectivityRepo.createPendingBankConnection).mockResolvedValue(connection());

    await initiateBankConnection("co_1", "FNB", "production", NOW);
    await initiateBankConnection("co_1", "FNB", "production", NOW);

    const [stateA] = vi.mocked(connectivityRepo.createOAuthState).mock.calls[0];
    const [stateB] = vi.mocked(connectivityRepo.createOAuthState).mock.calls[1];
    expect(stateA).not.toBe(stateB);
  });
});

describe("completeBankConnectionAuthorization (mandatory security: CSRF/state validation)", () => {
  it("rejects a callback whose state is unknown/expired/already consumed", async () => {
    vi.mocked(connectivityRepo.consumeOAuthState).mockResolvedValue(null);
    await expect(completeBankConnectionAuthorization("bad-state", "code", NOW)).rejects.toThrow(ValidationError);
  });

  it("exchanges the real code server-side and stores ONLY encrypted tokens", async () => {
    vi.mocked(connectivityRepo.consumeOAuthState).mockResolvedValue({ state: "s", company_id: "co_1", provider: "FNB", bank_connection_id: 1, redirect_after: null, created_at: NOW, expires_at: NOW, consumed_at: NOW });
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider({ exchangeAuthorizationCode: vi.fn().mockResolvedValue({ accessToken: "real-access-token", refreshToken: "real-refresh-token", expiresInSeconds: 3600, grantedScope: "accounts" }) }));
    vi.mocked(connectivityRepo.markBankConnectionAuthorized).mockResolvedValue(connection());

    await completeBankConnectionAuthorization("good-state", "the-code", NOW);

    const [, , input] = vi.mocked(connectivityRepo.markBankConnectionAuthorized).mock.calls[0];
    expect(input.accessTokenEncrypted).not.toBe("real-access-token");
    expect(input.accessTokenEncrypted).not.toContain("real-access-token");
    expect(input.refreshTokenEncrypted).not.toContain("real-refresh-token");
  });

  it("marks the connection Error and rethrows when token exchange itself fails", async () => {
    vi.mocked(connectivityRepo.consumeOAuthState).mockResolvedValue({ state: "s", company_id: "co_1", provider: "FNB", bank_connection_id: 1, redirect_after: null, created_at: NOW, expires_at: NOW, consumed_at: NOW });
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider({ exchangeAuthorizationCode: vi.fn().mockRejectedValue(new Error("invalid_grant")) }));

    await expect(completeBankConnectionAuthorization("good-state", "bad-code", NOW)).rejects.toThrow("invalid_grant");
    expect(connectivityRepo.markBankConnectionError).toHaveBeenCalledWith("co_1", 1, "invalid_grant", NOW);
  });
});

describe("getAuthorizedSession (token refresh handling without real network calls)", () => {
  it("returns the decrypted access token directly when it has not expired", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection({ tokenExpiresAt: "2099-01-01T00:00:00.000Z" }));
    vi.mocked(connectivityRepo.getAccessTokenEncrypted).mockResolvedValue(encryptToken("still-valid-access-token"));

    const session = await getAuthorizedSession("co_1", connection({ tokenExpiresAt: "2099-01-01T00:00:00.000Z" }), NOW);

    expect(session.accessToken).toBe("still-valid-access-token");
  });

  it("refreshes automatically when the token has expired and the provider supports refresh", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection({ tokenExpiresAt: "2020-01-01T00:00:00.000Z" }));
    vi.mocked(connectivityRepo.getRefreshTokenEncrypted).mockResolvedValue(encryptToken("the-refresh-token"));
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider({ refreshAccessToken: vi.fn().mockResolvedValue({ accessToken: "brand-new-access-token", refreshToken: "brand-new-refresh-token", expiresInSeconds: 3600, grantedScope: "accounts" }) }));

    const session = await getAuthorizedSession("co_1", connection({ tokenExpiresAt: "2020-01-01T00:00:00.000Z" }), NOW);

    expect(session.accessToken).toBe("brand-new-access-token");
    expect(connectivityRepo.updateBankConnectionTokens).toHaveBeenCalled();
  });

  it("throws honestly when the token expired and there is no refresh token on file", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection({ tokenExpiresAt: "2020-01-01T00:00:00.000Z" }));
    vi.mocked(connectivityRepo.getRefreshTokenEncrypted).mockResolvedValue(null);
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider());

    await expect(getAuthorizedSession("co_1", connection({ tokenExpiresAt: "2020-01-01T00:00:00.000Z" }), NOW)).rejects.toThrow(ValidationError);
  });

  it("refuses to authorize a Disconnected connection", async () => {
    await expect(getAuthorizedSession("co_1", connection({ status: "Disconnected" }), NOW)).rejects.toThrow(ValidationError);
  });
});

describe("tokens never appear in client-facing objects (mandatory security)", () => {
  it("the BankConnection type/objects this module returns carry no token fields at all", async () => {
    const returned = connection();
    expect(returned).not.toHaveProperty("accessToken");
    expect(returned).not.toHaveProperty("access_token_encrypted");
    expect(returned).not.toHaveProperty("refreshToken");
    expect(returned).not.toHaveProperty("refresh_token_encrypted");
  });

  it("initiateBankConnection's result never carries a token, only a real authorization URL", async () => {
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider());
    vi.mocked(connectivityRepo.createPendingBankConnection).mockResolvedValue(connection({ status: "PendingAuthorization" }));

    const result = await initiateBankConnection("co_1", "FNB", "production", NOW);

    expect(JSON.stringify(result)).not.toMatch(/access.?token|refresh.?token/i);
  });
});

describe("listProviderAccounts / linkBankConnectionAccount", () => {
  it("throws NotFoundError for a connection that does not exist", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(null);
    await expect(listProviderAccounts("co_1", 999, NOW)).rejects.toThrow(NotFoundError);
  });

  it("links a newly-selected account to an EXISTING target bank account when one is given, never auto-creating in that case", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection());
    vi.mocked(bankAccountRepo.getBankAccount).mockResolvedValue({ id: 42 } as never);
    vi.mocked(connectivityRepo.linkBankConnectionAccount).mockResolvedValue({
      id: 1, companyId: "co_1", bankConnectionId: 1, bankAccountId: 42, providerAccountId: "fnb-1", maskedAccountNumber: "•• 1", accountHolderName: "Acme", currency: "ZAR", status: "Active",
      lastSyncedThrough: null, lastSyncStatus: null, lastSyncAt: null, lastTransactionReceivedAt: null, createdAt: NOW,
    });

    await linkBankConnectionAccount("co_1", { connectionId: 1, providerAccountId: "fnb-1", accountHolderName: "Acme", maskedAccountNumber: "•• 1", currency: "ZAR", targetBankAccountId: 42, newBankAccountName: null });

    expect(bankAccountRepo.createBankAccount).not.toHaveBeenCalled();
    expect(connectivityRepo.linkBankConnectionAccount).toHaveBeenCalledWith("co_1", expect.objectContaining({ bankAccountId: 42 }));
  });

  it("creates a new bank account when no target is given, using the real linked-account details", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection());
    vi.mocked(bankAccountRepo.createBankAccount).mockResolvedValue({ id: 77 } as never);
    vi.mocked(connectivityRepo.linkBankConnectionAccount).mockResolvedValue({
      id: 1, companyId: "co_1", bankConnectionId: 1, bankAccountId: 77, providerAccountId: "fnb-1", maskedAccountNumber: "•• 1", accountHolderName: "Acme", currency: "ZAR", status: "Active",
      lastSyncedThrough: null, lastSyncStatus: null, lastSyncAt: null, lastTransactionReceivedAt: null, createdAt: NOW,
    });

    await linkBankConnectionAccount("co_1", { connectionId: 1, providerAccountId: "fnb-1", accountHolderName: "Acme", maskedAccountNumber: "•• 1", currency: "ZAR", targetBankAccountId: null, newBankAccountName: "FNB Cheque Account" });

    expect(bankAccountRepo.createBankAccount).toHaveBeenCalledTimes(1);
    expect(connectivityRepo.linkBankConnectionAccount).toHaveBeenCalledWith("co_1", expect.objectContaining({ bankAccountId: 77 }));
  });

  it("throws ValidationError when neither a target nor a new-account name is given", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection());
    await expect(linkBankConnectionAccount("co_1", { connectionId: 1, providerAccountId: "fnb-1", accountHolderName: "Acme", maskedAccountNumber: "", currency: "ZAR", targetBankAccountId: null, newBankAccountName: null })).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError when connectionId does not belong to (or does not exist for) this company — tenant-isolation guard", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(null);

    await expect(
      linkBankConnectionAccount("co_1", { connectionId: 999, providerAccountId: "fnb-1", accountHolderName: "Acme", maskedAccountNumber: "•• 1", currency: "ZAR", targetBankAccountId: 42, newBankAccountName: null }),
    ).rejects.toThrow(NotFoundError);
    expect(connectivityRepo.linkBankConnectionAccount).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when targetBankAccountId does not belong to (or does not exist for) this company — prevents cross-tenant FK corruption", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection());
    vi.mocked(bankAccountRepo.getBankAccount).mockResolvedValue(null);

    await expect(
      linkBankConnectionAccount("co_1", { connectionId: 1, providerAccountId: "fnb-1", accountHolderName: "Acme", maskedAccountNumber: "•• 1", currency: "ZAR", targetBankAccountId: 999, newBankAccountName: null }),
    ).rejects.toThrow(NotFoundError);
    expect(connectivityRepo.linkBankConnectionAccount).not.toHaveBeenCalled();
  });
});

describe("disconnectBankConnection", () => {
  it("marks the connection Disconnected even when the provider-side disconnect call fails", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection({ status: "Connected", tokenExpiresAt: "2099-01-01T00:00:00.000Z" }));
    vi.mocked(connectivityRepo.getAccessTokenEncrypted).mockResolvedValue(encryptToken("at"));
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider({ disconnect: vi.fn().mockRejectedValue(new Error("provider unreachable")) }));

    await disconnectBankConnection("co_1", 1, NOW);

    expect(connectivityRepo.disconnectBankConnection).toHaveBeenCalledWith("co_1", 1, NOW);
  });

  it("throws NotFoundError for a connection that does not exist", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(null);
    await expect(disconnectBankConnection("co_1", 999, NOW)).rejects.toThrow(NotFoundError);
  });
});

describe("healthCheckConnection (error handling)", () => {
  it("records and returns Ok on a real successful health check", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection({ tokenExpiresAt: "2099-01-01T00:00:00.000Z" }));
    vi.mocked(connectivityRepo.getAccessTokenEncrypted).mockResolvedValue(encryptToken("at"));
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider({ healthCheck: vi.fn().mockResolvedValue({ ok: true }) }));

    const result = await healthCheckConnection("co_1", 1, NOW);

    expect(result).toEqual({ ok: true, message: null });
    expect(connectivityRepo.recordBankConnectionHealthCheck).toHaveBeenCalledWith("co_1", 1, "Ok", null, NOW);
  });

  it("records and returns a real failure message, never fabricating success", async () => {
    vi.mocked(connectivityRepo.getBankConnection).mockResolvedValue(connection({ tokenExpiresAt: "2099-01-01T00:00:00.000Z" }));
    vi.mocked(connectivityRepo.getAccessTokenEncrypted).mockResolvedValue(encryptToken("at"));
    vi.mocked(createFnbProvider).mockReturnValue(fakeProvider({ healthCheck: vi.fn().mockResolvedValue({ ok: false, message: "401 Unauthorized" }) }));

    const result = await healthCheckConnection("co_1", 1, NOW);

    expect(result).toEqual({ ok: false, message: "401 Unauthorized" });
    expect(connectivityRepo.recordBankConnectionHealthCheck).toHaveBeenCalledWith("co_1", 1, "Error", "401 Unauthorized", NOW);
  });
});
