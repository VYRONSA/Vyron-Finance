/**
 * Phase 5L, Decision 2 — guard tests for the data-minimisation boundary.
 *
 * These exist because VYRON COST wrote, to stdout, the first 100 bytes of
 * every raw invoice in hex AND ASCII, a prompt preview, the base64 head of
 * the document data URL, and the entire provider response body on any
 * error. Reading that code is one thing; proving this codebase cannot do it
 * is another, and only the second survives future edits.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildLogPayload,
  containsForbiddenKey,
  logExtractionEvent,
  operatorMessageFor,
  PROVIDER_MESSAGE_MAX_LENGTH,
  sanitizeProviderMessage,
} from "./redaction";

/** A stand-in for real invoice bytes: long, base64-ish, and recognisable. */
const FAKE_PDF_BASE64 = "JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PC9GaWx0ZXIvRmxhdGVEZWNvZGUvTGVuZ3RoIDEyMzQ+PgpzdHJlYW0KSInNVstuFDEQvOcr+giHOLE9fs0RIRA3JHLjgFCEEEIc+H_SEC_RET";
const DATA_URI = `data:application/pdf;base64,${FAKE_PDF_BASE64}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitizeProviderMessage", () => {
  it("removes a base64 data URI", () => {
    const out = sanitizeProviderMessage(`Failed to parse ${DATA_URI} at offset 12`);
    expect(out).not.toContain("JVBERi0xLjQ");
    expect(out).toContain("[redacted data-uri]");
  });

  it("removes a long opaque blob even without a data: prefix", () => {
    const out = sanitizeProviderMessage(`unexpected token in ${FAKE_PDF_BASE64}`);
    expect(out).not.toContain("JVBERi0xLjQ");
    expect(out).toContain("[redacted blob]");
  });

  it("removes an API key and a bearer credential", () => {
    expect(sanitizeProviderMessage("bad key sk-abcdefghijklmnopqrstuvwxyz123456")).not.toContain("abcdefghijklmnop");
    expect(sanitizeProviderMessage("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toContain("[redacted credential]");
  });

  it("removes a PEM block", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----";
    expect(sanitizeProviderMessage(`config error ${pem}`)).not.toContain("MIIEvQIBADANBg");
  });

  it("collapses a multi-line provider dump to one line, so it cannot smuggle a document through", () => {
    const out = sanitizeProviderMessage("line one\nline two\n\tline three");
    expect(out).toBe("line one line two line three");
    expect(out).not.toContain("\n");
  });

  it("truncates hard at the column's own limit", () => {
    const out = sanitizeProviderMessage("x".repeat(5000));
    expect(out.length).toBeLessThanOrEqual(PROVIDER_MESSAGE_MAX_LENGTH);
  });

  it("handles an Error, an object and null without throwing or leaking a stack", () => {
    expect(sanitizeProviderMessage(new Error("boom"))).toBe("boom");
    expect(sanitizeProviderMessage({ error: "rate limited" })).toContain("rate limited");
    expect(sanitizeProviderMessage(null)).toBe("");
  });

  it("keeps a short, genuinely useful provider sentence", () => {
    expect(sanitizeProviderMessage("Rate limit reached for gpt-4o")).toBe("Rate limit reached for gpt-4o");
  });
});

describe("operator messages", () => {
  it("are ours, not the provider's, for every category", () => {
    for (const category of [
      "missing-api-key", "unauthorized", "payment-required", "forbidden", "configuration", "timeout",
      "rate-limit", "server-error", "provider-error", "network", "malformed-response", "unsupported-document", "unknown",
    ] as const) {
      const message = operatorMessageFor(category);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/openai|anthropic|api key|http \d{3}/i);
    }
  });

  it("tell the person their document is safe, and what they can do", () => {
    expect(operatorMessageFor("payment-required")).toMatch(/document is saved/i);
    expect(operatorMessageFor("payment-required")).toMatch(/by hand/i);
  });
});

describe("buildLogPayload — a closed shape", () => {
  it("emits only metadata", () => {
    const payload = buildLogPayload({
      event: "extraction.succeeded",
      companyId: "co_1",
      captureId: 42,
      documentId: 7,
      attempt: 1,
      model: "openai/gpt-4o-mini",
      durationMs: 4312,
      outcome: "extracted",
      usage: { inputTokens: 1200, outputTokens: 400, totalTokens: 1600 },
      lineCount: 12,
      findingCount: 0,
    });
    expect(payload).toMatchObject({ captureId: 42, lineCount: 12, model: "openai/gpt-4o-mini" });
    expect(containsForbiddenKey(payload)).toBe(false);
  });

  it("DROPS any key it does not explicitly allow", () => {
    const payload = buildLogPayload({
      event: "extraction.succeeded",
      companyId: "co_1",
      captureId: 42,
      // A future caller trying to widen what is logged:
      prompt: "You are VYRON… here is the invoice",
      base64: FAKE_PDF_BASE64,
      rawResponse: "{...the whole model answer...}",
      supplierName: "Acme Foods",
    } as never);
    expect(Object.keys(payload).sort()).toEqual(["captureId", "companyId", "event"]);
    expect(JSON.stringify(payload)).not.toContain("JVBERi0xLjQ");
    expect(JSON.stringify(payload)).not.toContain("Acme Foods");
  });

  it("sanitises the message field on its way through", () => {
    const payload = buildLogPayload({ event: "e", companyId: "c", captureId: 1, message: `failed ${DATA_URI}` });
    expect(String(payload.message)).not.toContain("JVBERi0xLjQ");
  });
});

describe("containsForbiddenKey", () => {
  it("recognises the shapes that leaked in COST", () => {
    expect(containsForbiddenKey({ rawResponse: "x" })).toBe(true);
    expect(containsForbiddenKey({ log: { first100Bytes: "…", prompt: "…" } })).toBe(true);
    expect(containsForbiddenKey({ a: { b: { c: { dataUrl: "…" } } } })).toBe(true);
    expect(containsForbiddenKey({ nested: { messages: [] } })).toBe(true);
  });

  it("passes a clean metadata payload", () => {
    expect(containsForbiddenKey({ captureId: 1, model: "x", usage: { totalTokens: 10 } })).toBe(false);
  });
});

describe("logExtractionEvent — the only sanctioned log channel", () => {
  it("never writes invoice content, however it is handed one", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logExtractionEvent({
      event: "extraction.failed",
      companyId: "co_1",
      captureId: 9,
      errorCategory: "malformed-response",
      message: `provider said: ${DATA_URI} while parsing`,
      // Not part of the type; a caller doing this anyway must still be safe.
      rawResponse: FAKE_PDF_BASE64,
      bytes: new Uint8Array([1, 2, 3]),
    } as never);

    expect(spy).toHaveBeenCalledTimes(1);
    const written = spy.mock.calls[0].join(" ");
    expect(written).not.toContain("JVBERi0xLjQ");
    expect(written).not.toContain("rawResponse");
    expect(written).not.toContain("bytes");
    expect(written).toContain("extraction.failed");
    expect(written).toContain("malformed-response");
  });

  it("emits one line, so a payload cannot span log entries", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logExtractionEvent({ event: "e", companyId: "c", captureId: 1, message: "a\nb\nc" });
    expect(spy.mock.calls[0].join(" ")).not.toMatch(/\n/);
  });
});

describe("the source itself carries no transcript sink", () => {
  it("there is no exported function that stores a raw provider response", async () => {
    const redaction = await import("./redaction");
    const names = Object.keys(redaction);
    expect(names.some((n) => /raw|transcript|dump/i.test(n))).toBe(false);
  });
});
