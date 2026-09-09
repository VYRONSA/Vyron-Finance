import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFnbProvider, FNB_CAPABILITIES } from "./fnb-provider";

const REQUIRED_ENV = {
  FNB_CLIENT_ID: "test-client-id",
  FNB_CLIENT_SECRET: "test-client-secret",
  FNB_REDIRECT_URI: "https://vyron.example/api/bank-connections/fnb/callback",
  FNB_AUTHORIZATION_URL: "https://fnb.example/oauth/authorize",
  FNB_TOKEN_URL: "https://fnb.example/oauth/token",
  FNB_API_BASE_URL: "https://fnb.example/api/",
};
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  for (const [key, value] of Object.entries(REQUIRED_ENV)) process.env[key] = value;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("FNB_CAPABILITIES (provider capability handling)", () => {
  it("confirms only the capabilities FNB's own documentation actually supports (FINDINGS.md §14)", () => {
    expect(FNB_CAPABILITIES).toEqual({
      supportsOAuthAuthorizationCode: true,
      supportsTokenRefresh: true,
      supportsBalances: true,
      supportsTransactionHistory: true,
      supportsRealtimeNotifications: false,
    });
  });

  it("never claims real-time/push support — FNB's own docs confirm polling only", () => {
    expect(createFnbProvider().capabilities.supportsRealtimeNotifications).toBe(false);
  });
});

describe("createFnbProvider — end-to-end composition (normalised mapping)", () => {
  it("getAuthorizationUrl returns a real FNB URL carrying the caller's state", () => {
    const provider = createFnbProvider();
    const url = provider.getAuthorizationUrl({ state: "csrf-state-value" });
    expect(new URL(url).searchParams.get("state")).toBe("csrf-state-value");
  });

  it("exchangeAuthorizationCode maps the raw token response into a TokenSet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 1800, scope: "accounts" }) }));
    const provider = createFnbProvider();
    const tokenSet = await provider.exchangeAuthorizationCode({ code: "auth-code" });
    expect(tokenSet).toEqual({ accessToken: "at", refreshToken: "rt", expiresInSeconds: 1800, grantedScope: "accounts" });
  });

  it("getAccounts maps a real accounts response through the FNB mapper (normalised mapping)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accounts: [{ accountId: "acc-1", accountHolderName: "Acme", accountNumberMasked: "••1234", accountType: "Cheque", currency: "ZAR" }] }) }));
    const provider = createFnbProvider();
    const accounts = await provider.getAccounts({ accessToken: "at" });
    expect(accounts).toEqual([{ providerAccountId: "acc-1", accountHolderName: "Acme", maskedAccountNumber: "••1234", accountType: "Cheque", currency: "ZAR" }]);
  });

  it("getTransactions maps a real transactions response through the FNB mapper (normalised mapping)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ accountId: "acc-1", transactions: [{ transactionId: "t1", valueDate: "2026-08-10", bookingDate: "2026-08-10", transactionDetails: "d", reference: "r", amount: 50, currency: "ZAR", debitCreditIndicator: "DEBIT", balance: 100 }] }),
      }),
    );
    const provider = createFnbProvider();
    const items = await provider.getTransactions({ accessToken: "at" }, { providerAccountId: "acc-1", rangeStart: "2026-08-01", rangeEnd: "2026-08-11" });
    expect(items).toEqual([{ providerTransactionId: "t1", date: "2026-08-10", description: "d", reference: "r", amount: 50, direction: "debit", balanceAfter: 100, currency: "ZAR" }]);
  });

  it("healthCheck returns ok:true on a successful accounts call, without fabricating success on failure (error handling)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accounts: [] }) }));
    const provider = createFnbProvider();
    expect(await provider.healthCheck({ accessToken: "at" })).toEqual({ ok: true });
  });

  it("healthCheck returns ok:false with a real message when the underlying call fails (error handling)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const provider = createFnbProvider();
    const result = await provider.healthCheck({ accessToken: "expired" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });

  it("disconnect never throws even though FNB documents no revocation endpoint (error handling)", async () => {
    const provider = createFnbProvider();
    await expect(provider.disconnect({ accessToken: "at" })).resolves.toBeUndefined();
  });
});
