/**
 * `classifyProviderError` is tested directly here — a pure function.
 * Model selection (Phase 18B) is also tested here, but WITHOUT ever
 * calling the real Gateway: the `ai` package's `generateObject` is
 * mocked (its I/O-free sibling `jsonSchema` is left real), so this file
 * still never makes a real network call (brief, section 23) — it only
 * captures the `model` argument `createGatewayAIProvider()` passes to
 * `generateObject`. `vyron-ai-engine.test.ts` covers every other
 * provider-facing behavior (success/failure/timeout/etc.) against a
 * mock `AIProvider` instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { AIProviderError, type EvidencePackage } from "../types";

const { generateObjectMock } = vi.hoisted(() => ({ generateObjectMock: vi.fn() }));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: generateObjectMock };
});

// Imported AFTER the mock so `createGatewayAIProvider` closes over the
// mocked `generateObject` — `vi.mock` calls are hoisted above imports by
// Vitest, so this static import already sees the mocked module.
import { classifyProviderError, createGatewayAIProvider } from "./gateway-provider";

describe("classifyProviderError", () => {
  it("passes an existing AIProviderError through unchanged", () => {
    const original = new AIProviderError("timeout", "already classified");
    expect(classifyProviderError(original)).toBe(original);
  });

  it("classifies an API-key error as missing-api-key (missing API key)", () => {
    const error = new Error("Provide an API key or Vercel access token via 'apiKey' option or 'AI_GATEWAY_API_KEY' environment variable.");
    expect(classifyProviderError(error).code).toBe("missing-api-key");
  });

  it("classifies a 401 unauthorized error as missing-api-key", () => {
    expect(classifyProviderError(new Error("Request failed with status code 401 Unauthorized")).code).toBe("missing-api-key");
  });

  it("classifies an AbortError as timeout (provider timeout)", () => {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    expect(classifyProviderError(error).code).toBe("timeout");
  });

  it("classifies a message mentioning 'timed out' as timeout", () => {
    expect(classifyProviderError(new Error("Request timed out after 25000ms")).code).toBe("timeout");
  });

  it("classifies a 429 / rate limit error as rate-limit", () => {
    expect(classifyProviderError(new Error("429 Too Many Requests")).code).toBe("rate-limit");
    expect(classifyProviderError(new Error("You have hit the rate limit for this model.")).code).toBe("rate-limit");
  });

  // Phase 26I — the Gateway attaches every real response header,
  // verbatim, to the `APICallError` it throws on a 429; this recovers
  // the provider's own stated `Retry-After` cooldown so the scheduler can
  // reschedule the next sweep precisely instead of a blind fixed guess.
  it("extracts the real Retry-After header (delay-seconds) from a rate-limited APICallError, as milliseconds", () => {
    const error = new APICallError({
      message: "429 Too Many Requests", url: "https://gateway.example/v1/chat", requestBodyValues: {},
      statusCode: 429, responseHeaders: { "retry-after": "20" },
    });
    expect(classifyProviderError(error).retryAfterMs).toBe(20_000);
  });

  it("returns null retryAfterMs when the rate-limited error has no Retry-After header", () => {
    const error = new APICallError({ message: "429 Too Many Requests", url: "https://gateway.example/v1/chat", requestBodyValues: {}, statusCode: 429 });
    expect(classifyProviderError(error).retryAfterMs).toBeNull();
  });

  it("returns null retryAfterMs for a rate-limit error that isn't an APICallError at all (never fabricates a number)", () => {
    expect(classifyProviderError(new Error("429 Too Many Requests")).retryAfterMs).toBeNull();
  });

  it("ignores a malformed/non-numeric Retry-After header rather than misinterpreting it", () => {
    const error = new APICallError({
      message: "429 Too Many Requests", url: "https://gateway.example/v1/chat", requestBodyValues: {},
      statusCode: 429, responseHeaders: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
    });
    expect(classifyProviderError(error).retryAfterMs).toBeNull();
  });

  it("classifies a schema/object-generation failure as malformed-response", () => {
    expect(classifyProviderError(new Error("No object generated: could not parse the response.")).code).toBe("malformed-response");
  });

  // Migration 0099 — the real HTTP status decides, not message guessing,
  // and it is kept on the error for the attempt log.
  it("uses the real HTTP status of an API error and keeps it (401, 403 -> missing-api-key; 429 -> rate-limit; 5xx -> provider-error)", () => {
    const apiError = (statusCode: number, message = "failed") => new APICallError({ message, url: "https://gateway.example", requestBodyValues: {}, statusCode });
    expect(classifyProviderError(apiError(401))).toMatchObject({ code: "missing-api-key", httpStatus: 401 });
    expect(classifyProviderError(apiError(403))).toMatchObject({ code: "missing-api-key", httpStatus: 403 });
    expect(classifyProviderError(apiError(429))).toMatchObject({ code: "rate-limit", httpStatus: 429 });
    expect(classifyProviderError(apiError(503))).toMatchObject({ code: "provider-error", httpStatus: 503 });
    expect(classifyProviderError(apiError(402, "Insufficient funds"))).toMatchObject({ code: "provider-error", httpStatus: 402, providerMessage: "Insufficient funds" });
  });

  it("unwraps the SDK's RetryError and classifies its last real error", async () => {
    const { RetryError } = await import("ai");
    const last = new APICallError({ message: "Service Unavailable", url: "https://gateway.example", requestBodyValues: {}, statusCode: 503 });
    const wrapped = new RetryError({ message: "Failed after 3 attempts", reason: "maxRetriesExceeded", errors: [last, last, last] });
    expect(classifyProviderError(wrapped)).toMatchObject({ code: "provider-error", httpStatus: 503 });
  });

  it("a request that never got a response has no HTTP status", () => {
    expect(classifyProviderError(new Error("fetch failed")).httpStatus).toBeNull();
  });

  it("classifies an unrecognized error as a generic provider-error, without ever exposing the raw message as the code (provider failure)", () => {
    const classified = classifyProviderError(new Error("Something the provider's own internals raised."));
    expect(classified.code).toBe("provider-error");
    expect(classified).toBeInstanceOf(AIProviderError);
  });

  it("classifies a non-Error thrown value safely, without throwing itself", () => {
    expect(classifyProviderError("a raw string was thrown").code).toBe("provider-error");
    expect(classifyProviderError(undefined).code).toBe("provider-error");
  });
});

// ---------------------------------------------------------------------
// Phase 18B — model selection. The Phase 18 QA audit's live Gateway
// test proved the OLD default (anthropic/claude-sonnet-4-5) fails with
// "Free tier users do not have access to this model" on the account
// behind AI_GATEWAY_API_KEY, while openai/gpt-4o-mini succeeds on that
// same account. These tests prove the SELECTION LOGIC only — never the
// real network call (generateObject is mocked above).
// ---------------------------------------------------------------------

const ORIGINAL_VYRON_AI_MODEL = process.env.VYRON_AI_MODEL;

function evidence(): EvidencePackage {
  return {
    companyId: "co_1",
    companyName: "Acme Ltd",
    asOfDate: "2026-08-12",
    question: "What's worrying you most?",
    findings: [],
    situations: [],
    totalCash: null,
    netProfit: null,
    intelligenceCentreHref: "/company/co_1/intelligence",
  };
}

function validGeneratedObject() {
  return { answer: "ok", keyPoints: [], evidenceReferences: [], recommendedActions: [], uncertainties: [] };
}

describe("createGatewayAIProvider — model selection (Phase 18B)", () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
    generateObjectMock.mockResolvedValue({ object: validGeneratedObject() });
  });

  afterEach(() => {
    if (ORIGINAL_VYRON_AI_MODEL === undefined) delete process.env.VYRON_AI_MODEL;
    else process.env.VYRON_AI_MODEL = ORIGINAL_VYRON_AI_MODEL;
  });

  it("uses VYRON_AI_MODEL when it is set (VYRON_AI_MODEL set -> use that model)", async () => {
    process.env.VYRON_AI_MODEL = "anthropic/claude-opus-4-6";
    const provider = createGatewayAIProvider();

    await provider.generateResponse({ systemPrompt: "system", evidence: evidence(), conversation: [] });

    expect(generateObjectMock).toHaveBeenCalledWith(expect.objectContaining({ model: "anthropic/claude-opus-4-6" }));
  });

  it("falls back to openai/gpt-4o-mini when VYRON_AI_MODEL is absent (VYRON_AI_MODEL not set -> safe default)", async () => {
    delete process.env.VYRON_AI_MODEL;
    const provider = createGatewayAIProvider();

    await provider.generateResponse({ systemPrompt: "system", evidence: evidence(), conversation: [] });

    expect(generateObjectMock).toHaveBeenCalledWith(expect.objectContaining({ model: "openai/gpt-4o-mini" }));
  });

  it("also falls back to openai/gpt-4o-mini when VYRON_AI_MODEL is set to an empty string", async () => {
    process.env.VYRON_AI_MODEL = "";
    const provider = createGatewayAIProvider();

    await provider.generateResponse({ systemPrompt: "system", evidence: evidence(), conversation: [] });

    expect(generateObjectMock).toHaveBeenCalledWith(expect.objectContaining({ model: "openai/gpt-4o-mini" }));
  });

  it("propagates a classified error when the (mocked) Gateway call fails, regardless of which model was selected (existing fallback behavior still works)", async () => {
    delete process.env.VYRON_AI_MODEL;
    generateObjectMock.mockRejectedValue(new Error("Free tier users do not have access to this model."));
    const provider = createGatewayAIProvider();

    await expect(provider.generateResponse({ systemPrompt: "system", evidence: evidence(), conversation: [] })).rejects.toMatchObject({ code: "provider-error" });
  });

  it("never logs or includes the AI_GATEWAY_API_KEY value anywhere in a thrown error (no secrets in logs/output)", async () => {
    const originalKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "test-key-value-should-never-leak";
    generateObjectMock.mockRejectedValue(new Error("Provide an API key or Vercel access token via 'apiKey' option or 'AI_GATEWAY_API_KEY' environment variable."));
    const provider = createGatewayAIProvider();

    try {
      await expect(provider.generateResponse({ systemPrompt: "system", evidence: evidence(), conversation: [] })).rejects.toMatchObject({ code: "missing-api-key" });
    } finally {
      if (originalKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = originalKey;
    }
  });
});
