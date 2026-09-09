import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizationUrl, exchangeCodeForToken, fetchAccountBalance, fetchAccounts, fetchTransactions, FnbApiError, fnbConfig, FnbConfigError, refreshToken } from "./fnb-client";

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
  delete process.env.FNB_ENVIRONMENT;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fnbConfig (error handling)", () => {
  it("resolves real config from environment variables when every required var is set", () => {
    const config = fnbConfig();
    expect(config.clientId).toBe("test-client-id");
    expect(config.environment).toBe("production");
  });

  it("defaults to development only when FNB_ENVIRONMENT is explicitly 'development'", () => {
    process.env.FNB_ENVIRONMENT = "development";
    expect(fnbConfig().environment).toBe("development");
  });

  it("throws a specific, named error for each missing required variable rather than silently using an invented URL", () => {
    delete process.env.FNB_CLIENT_ID;
    expect(() => fnbConfig()).toThrow(FnbConfigError);
    expect(() => fnbConfig()).toThrow(/FNB_CLIENT_ID/);
  });

  it("throws for a missing FNB_AUTHORIZATION_URL specifically", () => {
    delete process.env.FNB_AUTHORIZATION_URL;
    expect(() => fnbConfig()).toThrow(/FNB_AUTHORIZATION_URL/);
  });
});

describe("buildAuthorizationUrl", () => {
  it("builds a real authorization URL carrying the caller's own state (CSRF protection)", () => {
    const url = buildAuthorizationUrl(fnbConfig(), "the-real-random-state-value");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://fnb.example/oauth/authorize");
    expect(parsed.searchParams.get("state")).toBe("the-real-random-state-value");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(REQUIRED_ENV.FNB_REDIRECT_URI);
    expect(parsed.searchParams.get("response_type")).toBe("code");
  });
});

describe("exchangeCodeForToken / refreshToken (token refresh handling without real network calls)", () => {
  it("exchanges a real authorization code for a token set via a mocked fetch — never a real network call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "real-access-token", refresh_token: "real-refresh-token", expires_in: 3600, token_type: "Bearer", scope: "accounts transactions" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeCodeForToken(fnbConfig(), "the-auth-code");

    expect(result.access_token).toBe("real-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(REQUIRED_ENV.FNB_TOKEN_URL);
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-auth-code");
    expect(body.get("client_secret")).toBe("test-client-secret");
  });

  it("refreshes an access token via a mocked fetch using grant_type=refresh_token (token refresh handling without real network calls)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "new-access-token", expires_in: 3600, token_type: "Bearer" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshToken(fnbConfig(), "the-old-refresh-token");

    expect(result.access_token).toBe("new-access-token");
    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("the-old-refresh-token");
  });

  it("throws FnbApiError without leaking the response body when the token endpoint returns a non-OK response (error handling)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "invalid_grant", error_description: "token revoked" }) }));
    await expect(exchangeCodeForToken(fnbConfig(), "bad-code")).rejects.toThrow(FnbApiError);
  });

  it("throws FnbApiError when the response is OK but missing access_token (malformed response handling)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unexpected: "shape" }) }));
    await expect(exchangeCodeForToken(fnbConfig(), "a-code")).rejects.toThrow(FnbApiError);
  });
});

describe("fetchAccounts / fetchAccountBalance / fetchTransactions (date range mapping)", () => {
  it("sends a Bearer token and no request body for fetchAccounts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accounts: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await fetchAccounts(fnbConfig(), "the-access-token");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer the-access-token");
  });

  it("requests a balance for the exact given account id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await fetchAccountBalance(fnbConfig(), "token", "acc-999");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/accounts/acc-999/balance");
  });

  it("maps the given date range onto the request's from/to query parameters (date range mapping)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transactions: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await fetchTransactions(fnbConfig(), "token", "acc-1", "2026-05-01", "2026-08-11");
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("from")).toBe("2026-05-01");
    expect(parsed.searchParams.get("to")).toBe("2026-08-11");
    expect(parsed.pathname).toContain("/accounts/acc-1/transactions");
  });

  it("throws FnbApiError for a non-OK data response (error handling)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(fetchTransactions(fnbConfig(), "token", "acc-1", "2026-05-01", "2026-08-11")).rejects.toThrow(FnbApiError);
  });
});
