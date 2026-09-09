/**
 * Phase 16 — thin HTTP client for FNB's Transaction History API.
 *
 * Every URL is read from environment configuration, NEVER hard-coded —
 * FNB's public catalogue page does not publish base URLs or endpoint
 * paths (FINDINGS.md §14/§15); those are only issued during developer
 * onboarding. `fnbConfig()` throws a clear, specific error naming
 * exactly which variable is missing rather than silently falling back
 * to an invented URL — this is the deliberate boundary the brief asks
 * to be reported, not built past.
 *
 * This module never logs a request/response body (which could contain
 * an access token or account data) — only high-level outcome (status
 * code, elapsed time) would ever be logged here, and no logging call
 * exists in this file at all today.
 */

import type { FnbTokenResponse } from "./fnb-types";

export class FnbConfigError extends Error {}
export class FnbApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type FnbConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** "development" or "production" — see BankEnvironment's own
   * docstring; not an FNB-provided sandbox distinction. */
  environment: "development" | "production";
  authorizationBaseUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new FnbConfigError(
      `${name} is not configured. This is an FNB developer-onboarding-dependent value (see src/server/bank-connectivity/FINDINGS.md §15) — set it in .env.local once FNB issues it.`,
    );
  }
  return value;
}

export function fnbConfig(): FnbConfig {
  return {
    clientId: requireEnv("FNB_CLIENT_ID"),
    clientSecret: requireEnv("FNB_CLIENT_SECRET"),
    redirectUri: requireEnv("FNB_REDIRECT_URI"),
    environment: process.env.FNB_ENVIRONMENT === "development" ? "development" : "production",
    authorizationBaseUrl: requireEnv("FNB_AUTHORIZATION_URL"),
    tokenUrl: requireEnv("FNB_TOKEN_URL"),
    apiBaseUrl: requireEnv("FNB_API_BASE_URL"),
  };
}

export function buildAuthorizationUrl(config: FnbConfig, state: string): string {
  const url = new URL(config.authorizationBaseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function parseTokenResponse(res: Response): Promise<FnbTokenResponse> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body !== "object" || typeof (body as FnbTokenResponse).access_token !== "string") {
    // Deliberately does not include the raw response body in the thrown
    // message — it could contain a token.
    throw new FnbApiError(`FNB token endpoint returned an unexpected response (status ${res.status}).`, res.status);
  }
  return body as FnbTokenResponse;
}

export async function exchangeCodeForToken(config: FnbConfig, code: string): Promise<FnbTokenResponse> {
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  return parseTokenResponse(res);
}

export async function refreshToken(config: FnbConfig, refreshTokenValue: string): Promise<FnbTokenResponse> {
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTokenValue,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  return parseTokenResponse(res);
}

async function getJson(config: FnbConfig, path: string, accessToken: string, searchParams?: Record<string, string>): Promise<unknown> {
  const url = new URL(path, config.apiBaseUrl);
  if (searchParams) for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, value);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!res.ok) throw new FnbApiError(`FNB API request to ${path} failed (status ${res.status}).`, res.status);
  return res.json();
}

/** Path segments below (`/accounts`, `/accounts/{id}/balance`,
 * `/accounts/{id}/transactions`) are NOT confirmed against FNB's real
 * OpenAPI Specification (FINDINGS.md §15) — they are the conventional
 * REST shape for the documented capabilities, isolated here as the one
 * place to correct once the real spec is available. */
export async function fetchAccounts(config: FnbConfig, accessToken: string): Promise<unknown> {
  return getJson(config, "/accounts", accessToken);
}

export async function fetchAccountBalance(config: FnbConfig, accessToken: string, providerAccountId: string): Promise<unknown> {
  return getJson(config, `/accounts/${encodeURIComponent(providerAccountId)}/balance`, accessToken);
}

/** FNB's own documented parameters: a chosen account and a date range
 * (FINDINGS.md §14) — mapped here to `from`/`to` query params, polled
 * (never assumed real-time) per FNB's own documented polling model. */
export async function fetchTransactions(config: FnbConfig, accessToken: string, providerAccountId: string, rangeStart: string, rangeEnd: string): Promise<unknown> {
  return getJson(config, `/accounts/${encodeURIComponent(providerAccountId)}/transactions`, accessToken, { from: rangeStart, to: rangeEnd });
}
