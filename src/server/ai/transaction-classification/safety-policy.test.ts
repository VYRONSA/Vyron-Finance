/**
 * Migration 0099 — the pure AI classification safety rules: how a failure
 * is categorized (which decides batch stops, the circuit breaker and
 * whether a provider request is counted), message sanitization, and usage
 * capture. No database, no network.
 */
import { afterEach, describe, expect, it } from "vitest";
import { AIProviderError } from "@/server/ai/types";
import { boundRetryAfterMs, classifyClassificationFailure, extractProviderUsage, PROVIDER_MESSAGE_MAX_LENGTH, sanitizeProviderMessage } from "./safety-policy";

const err = (code: ConstructorParameters<typeof AIProviderError>[0], details: ConstructorParameters<typeof AIProviderError>[3] = {}, retryAfterMs: number | null = null) =>
  new AIProviderError(code, "classified", retryAfterMs, details);

describe("classifyClassificationFailure", () => {
  it.each([
    [401, "unauthorized"],
    [402, "payment-required"],
    [403, "forbidden"],
    [404, "configuration"],
  ] as const)("HTTP %i -> %s: opens the circuit immediately (auth) and stops the batch", (httpStatus, category) => {
    const c = classifyClassificationFailure(err("provider-error", { httpStatus }));
    expect(c).toMatchObject({ category, httpStatus, circuitSignal: "auth", providerLevel: true, providerRequestMade: true });
  });

  it("a missing API key (no HTTP status) is auth, and no request reached the provider", () => {
    expect(classifyClassificationFailure(err("missing-api-key"))).toMatchObject({ category: "missing-api-key", circuitSignal: "auth", providerLevel: true, providerRequestMade: false });
  });

  it("a timeout counts toward the timeout threshold and was a real request", () => {
    expect(classifyClassificationFailure(err("timeout"))).toMatchObject({ category: "timeout", circuitSignal: "timeout", providerLevel: true, providerRequestMade: true });
    expect(classifyClassificationFailure(err("provider-error", { httpStatus: 408 }))).toMatchObject({ category: "timeout", circuitSignal: "timeout" });
  });

  it.each([500, 502, 503, 504, 424])("HTTP %i is a provider failure (5 in a row open the circuit)", (httpStatus) => {
    expect(classifyClassificationFailure(err("provider-error", { httpStatus }))).toMatchObject({ category: "server-error", circuitSignal: "provider_failure", providerLevel: true, providerRequestMade: true });
  });

  it("429 stops the batch, keeps Retry-After, and never opens the circuit by itself", () => {
    expect(classifyClassificationFailure(err("rate-limit", { httpStatus: 429 }, 30_000))).toMatchObject({ category: "rate-limit", circuitSignal: "rate_limit", providerLevel: true, retryAfterMs: 30_000 });
  });

  it("a network failure with no response stops the batch but is not a counted request", () => {
    expect(classifyClassificationFailure(err("provider-error", { providerMessage: "fetch failed" }))).toMatchObject({ category: "network", providerRequestMade: false, providerLevel: true, circuitSignal: "provider_failure" });
  });

  it("a malformed answer is a transaction outcome: counted, the batch continues, the provider counts as healthy", () => {
    expect(classifyClassificationFailure(err("malformed-response"))).toMatchObject({ category: "malformed-response", providerRequestMade: true, providerLevel: false, circuitSignal: "success" });
  });

  it("a validation failure (account not offered) is an invalid suggestion, counted, batch continues", () => {
    expect(classifyClassificationFailure(err("malformed-response", { validation: true }))).toMatchObject({ category: "invalid-suggestion", providerRequestMade: true, providerLevel: false, circuitSignal: "success" });
  });

  it("anything that is not a provider error is 'unknown': not counted, never trips the circuit", () => {
    expect(classifyClassificationFailure(new Error("boom"))).toMatchObject({ category: "unknown", providerRequestMade: false, providerLevel: false, circuitSignal: "none", httpStatus: null });
  });

  it("the message it keeps is the provider's own, sanitized", () => {
    const c = classifyClassificationFailure(err("provider-error", { httpStatus: 402, providerMessage: "Insufficient funds. token=abc123def456ghi" }));
    expect(c.providerMessage).toBe("Insufficient funds. token=[redacted]");
  });
});

describe("sanitizeProviderMessage", () => {
  const original = process.env.AI_GATEWAY_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = original;
  });

  it("removes the configured gateway key wherever it appears", () => {
    process.env.AI_GATEWAY_API_KEY = "synthetic-configured-key-value";
    expect(sanitizeProviderMessage("key synthetic-configured-key-value was rejected")).toBe("key [redacted] was rejected");
  });

  it("removes bearer tokens and authorization headers", () => {
    const s = sanitizeProviderMessage('{"headers":{"Authorization":"Bearer abc.def.ghi"}} failed')!;
    expect(s).not.toContain("abc.def.ghi");
    expect(s).toContain("[redacted]");
  });

  it.each([
    "api_key=0123456789abcdef",
    "x-api-key: 0123456789abcdef",
    "password=hunter2hunter2",
    "secret: s3cr3t-value",
    "access_token=zzzzyyyyxxxx",
  ])("removes the value of %s", (input) => {
    const value = input.split(/[:=]\s*/)[1]!;
    expect(sanitizeProviderMessage(`request failed ${input}`)).not.toContain(value);
  });

  it.each([
    "vck_0123456789abcdefghij",
    "sk-proj-0123456789abcdef",
    "sb_secret_0123456789abcdef",
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJl",
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
  ])("removes credential-shaped token %s", (token) => {
    expect(sanitizeProviderMessage(`failed with ${token} here`)).toBe("failed with [redacted] here");
  });

  it("keeps ordinary diagnostic text readable", () => {
    expect(sanitizeProviderMessage("Free tier users do not have access to this model.")).toBe("Free tier users do not have access to this model.");
  });

  it(`caps at ${PROVIDER_MESSAGE_MAX_LENGTH} characters and collapses whitespace`, () => {
    const s = sanitizeProviderMessage("a  b\n\nc ".repeat(200))!;
    expect(s.length).toBe(PROVIDER_MESSAGE_MAX_LENGTH);
    expect(s).not.toMatch(/\s{2,}/);
  });

  it("null/empty in, null out", () => {
    expect(sanitizeProviderMessage(null)).toBeNull();
    expect(sanitizeProviderMessage(undefined)).toBeNull();
    expect(sanitizeProviderMessage("   ")).toBeNull();
  });
});

describe("extractProviderUsage — only what the provider actually reported", () => {
  it("keeps finite token counts and the gateway's cost", () => {
    expect(extractProviderUsage({ inputTokens: 10, outputTokens: 2, totalTokens: 12, reasoningTokens: undefined }, { gateway: { cost: "0.0001" } })).toEqual({ inputTokens: 10, outputTokens: 2, totalTokens: 12, gatewayCost: 0.0001 });
  });

  it("returns null when nothing was reported (never an estimate)", () => {
    expect(extractProviderUsage(undefined)).toBeNull();
    expect(extractProviderUsage({ inputTokens: undefined, outputTokens: Number.NaN })).toBeNull();
  });

  it("never copies anything else from the provider metadata", () => {
    const usage = extractProviderUsage({ inputTokens: 1, raw: { headers: { authorization: "Bearer x" } } }, { gateway: { cost: "x", routing: { key: "k" } } });
    expect(usage).toEqual({ inputTokens: 1 });
  });
});

// -----------------------------------------------------------------------
// Pre-deployment review — bounded Retry-After, fixed texts for model
// answers, sanitization hardening.
// -----------------------------------------------------------------------

describe("Review — boundRetryAfterMs", () => {
  it.each([
    [20_000, 20_000],
    [1, 15_000],
    [60 * 60_000, 5 * 60_000],
    [Number.MAX_VALUE, 5 * 60_000],
    [0, null],
    [-1, null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    ["20", null],
    [null, null],
    [undefined, null],
  ])("%s -> %s", (given, expected) => {
    expect(boundRetryAfterMs(given)).toBe(expected);
  });

  it("a 429's Retry-After is bounded at classification time", () => {
    expect(classifyClassificationFailure(err("rate-limit", { httpStatus: 429 }, 60 * 60_000)).retryAfterMs).toBe(5 * 60_000);
    expect(classifyClassificationFailure(err("rate-limit", { httpStatus: 429 }, Number.NaN)).retryAfterMs).toBeNull();
  });
});

describe("Review — a model's raw answer is never kept", () => {
  it("malformed answers get a fixed description", () => {
    const c = classifyClassificationFailure(err("malformed-response", { providerMessage: 'Type validation failed: Value: {"explanation":"director loan"}' }));
    expect(c.providerMessage).toBe("The provider's answer could not be parsed or did not match the expected format.");
  });

  it("invalid suggestions get a fixed description", () => {
    const c = classifyClassificationFailure(err("malformed-response", { validation: true, providerMessage: "suggested 9999 for director loan" }));
    expect(c.providerMessage).toBe("The provider suggested an account that was not among the offered candidates.");
  });
});

describe("Review — sanitizeProviderMessage hardening", () => {
  it.each([
    ["URL credentials", "GET https://user:p4ssw0rd@api.example.com/v1 failed", ["p4ssw0rd", "user:"]],
    ["Authorization with any scheme", "Authorization: Token abc def ghi", ["abc def ghi"]],
    ["Basic auth", "basic dXNlcjpwYXNz rejected", ["dXNlcjpwYXNz"]],
    ["cookies", "set-cookie: session=s3ss10nv4lue; Path=/", ["s3ss10nv4lue"]],
    ["long quoted payload", 'bad input "the quick brown fox paid R1245.60 to a private supplier"', ["private supplier"]],
    ["JSON body", 'body {"messages":[{"role":"user","content":"x"}],"model":"openai/gpt-4o-mini","secretish":"y"}', ['"messages"']],
  ])("%s", (_label, input, forbidden) => {
    const s = sanitizeProviderMessage(input as string) ?? "";
    for (const f of forbidden as string[]) expect(s).not.toContain(f);
  });

  it("removes the caller's sensitive values, case-insensitively, ignoring values under 4 characters", () => {
    expect(sanitizeProviderMessage("rejected: pick n pay somerset / ab", ["PICK N PAY", "ab"])).toBe("rejected: [redacted] somerset / ab");
  });

  it("the 300-character bound applies to the final, sanitized text even when redaction lengthens it", () => {
    const s = sanitizeProviderMessage("key=ab ".repeat(200))!;
    expect(s.length).toBeLessThanOrEqual(PROVIDER_MESSAGE_MAX_LENGTH);
    expect(s).not.toContain("key=ab");
  });
});
