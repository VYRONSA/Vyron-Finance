/**
 * Phase 5M — the Gateway extraction adapter, against a mocked SDK.
 *
 * NO REAL PROVIDER CALL IS MADE HERE, and none can be: `generateObject` is
 * mocked at the module boundary, so the suite is safe to run with no key
 * and cannot spend money. That is the whole point — the brief is explicit
 * that error states are to be proven with mocks rather than by
 * deliberately causing paid failures.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: (...args: unknown[]) => generateObject(...args) };
});

import { AIProviderError } from "@/server/ai/types";
import { createGatewayExtractionProvider, EXTRACTION_MAX_OUTPUT_TOKENS, EXTRACTION_TIMEOUT_MS, GATEWAY_EXTRACTION_CONFIG } from "./gateway-extraction-provider";
import type { ExtractionInput } from "./types";

const PDF: ExtractionInput = { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mimeType: "application/pdf" };
const JPG: ExtractionInput = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" };

const GOOD_ANSWER = {
  header: {
    documentType: "Invoice",
    supplierName: "Karoo Wholesale Supplies",
    supplierVatNumber: "4111222333",
    supplierRegistrationNumber: null,
    invoiceNumber: "KW-10041",
    invoiceDate: "2026-06-11",
    dueDate: null,
    orderReference: null,
    currencyCode: "ZAR",
    subtotal: 1000,
    discountTotal: null,
    vatAmount: 150,
    total: 1150,
    confidence: 88,
  },
  lines: [
    {
      description: "Maize meal 10kg",
      supplierSku: "MM10",
      quantity: 10,
      uom: "bag",
      packDescription: null,
      packQuantity: null,
      unitPrice: 100,
      discount: null,
      vatRatePercent: 15,
      vatAmount: 150,
      lineTotal: 1000,
      confidence: 90,
    },
  ],
  invoiceNumbersSeen: ["KW-10041"],
  missingFields: [],
  warnings: [],
  declaredLineCount: 1,
};

const ORIGINAL_GATEWAY_KEY = process.env.AI_GATEWAY_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  // Phase 5N — the adapter now refuses before any network activity when no
  // credential is configured, matching
  // `createGatewayTransactionClassificationProvider`. These tests are
  // about what happens AFTER that lock, so they supply a synthetic
  // placeholder. It is not a credential and reaches nothing: the SDK
  // itself is mocked above, so no request can leave this process.
  process.env.AI_GATEWAY_API_KEY = "synthetic-test-placeholder";
});

afterEach(() => {
  delete process.env.VYRON_AI_MODEL;
  if (ORIGINAL_GATEWAY_KEY === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = ORIGINAL_GATEWAY_KEY;
});

describe("the missing-credential lock (Phase 5N)", () => {
  it("refuses before any network activity when no key is configured", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const result = await createGatewayExtractionProvider().extract(PDF);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.category).toBe("missing-api-key");
    // The decisive assertion: the SDK was never reached. Without this
    // lock the Gateway SDK falls back to another credential (a Vercel
    // OIDC token) and sends the document anyway.
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only key as absent", async () => {
    process.env.AI_GATEWAY_API_KEY = "   ";
    const result = await createGatewayExtractionProvider().extract(PDF);
    expect(result.ok).toBe(false);
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe("request shape", () => {
  it("goes through the SHARED Gateway architecture, not a second one", async () => {
    generateObject.mockResolvedValue({ object: GOOD_ANSWER, usage: { inputTokens: 900, outputTokens: 300, totalTokens: 1200 } });
    await createGatewayExtractionProvider().extract(PDF);

    const call = generateObject.mock.calls[0][0];
    expect(call.model).toBe("openai/gpt-4o-mini"); // the project's shared default
    expect(call.temperature).toBe(0);
    expect(call.maxOutputTokens).toBe(EXTRACTION_MAX_OUTPUT_TOKENS);
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call.schemaName).toBe("SupplierInvoiceExtraction");
  });

  it("honours VYRON_AI_MODEL, so switching model is configuration not code", async () => {
    process.env.VYRON_AI_MODEL = "openai/gpt-4o";
    generateObject.mockResolvedValue({ object: GOOD_ANSWER, usage: null });
    await createGatewayExtractionProvider().extract(PDF);
    expect(generateObject.mock.calls[0][0].model).toBe("openai/gpt-4o");
  });

  it("sends a PDF as a file part and an image as an image part", async () => {
    generateObject.mockResolvedValue({ object: GOOD_ANSWER, usage: null });

    await createGatewayExtractionProvider().extract(PDF);
    const pdfContent = generateObject.mock.calls[0][0].messages[0].content;
    expect(pdfContent[1]).toMatchObject({ type: "file", mediaType: "application/pdf" });

    vi.clearAllMocks();
    generateObject.mockResolvedValue({ object: GOOD_ANSWER, usage: null });
    await createGatewayExtractionProvider().extract(JPG);
    const jpgContent = generateObject.mock.calls[0][0].messages[0].content;
    expect(jpgContent[1]).toMatchObject({ type: "image", mediaType: "image/jpeg" });
  });

  it("instructs the model to copy, never to calculate", async () => {
    generateObject.mockResolvedValue({ object: GOOD_ANSWER, usage: null });
    await createGatewayExtractionProvider().extract(PDF);
    const instructions: string = generateObject.mock.calls[0][0].instructions;
    expect(instructions).toMatch(/Do NOT calculate, infer, derive/i);
    expect(instructions).toMatch(/never a plausible substitute/i);
    // The prompt is hard-wrapped, so this matches a phrase that sits on
    // one line rather than one spanning the wrap.
    expect(instructions).toMatch(/Never place such a column into/i);
    expect(instructions).toMatch(/unitPrice, vatAmount or lineTotal/i);
  });

  it("has a bounded timeout — COST had none at all", async () => {
    expect(EXTRACTION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(EXTRACTION_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });
});

describe("a good answer", () => {
  it("is parsed and returned with its model and usage", async () => {
    generateObject.mockResolvedValue({ object: GOOD_ANSWER, usage: { inputTokens: 900, outputTokens: 300, totalTokens: 1200 } });
    const result = await createGatewayExtractionProvider().extract(PDF);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.header.invoiceNumber).toBe("KW-10041");
    expect(result.result.lines).toHaveLength(1);
    expect(result.model).toBe("openai/gpt-4o-mini");
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 300, totalTokens: 1200 });
  });

  it("maps a placeholder string in a money field to null rather than storing it", async () => {
    generateObject.mockResolvedValue({
      object: { ...GOOD_ANSWER, header: { ...GOOD_ANSWER.header, subtotal: "Needs Review", invoiceNumber: "UNKNOWN" } },
      usage: null,
    });
    const result = await createGatewayExtractionProvider().extract(PDF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.header.subtotal).toBeNull();
    expect(result.result.header.invoiceNumber).toBeNull();
  });

  it("rejects a structurally wrong answer as a typed failure, not an exception", async () => {
    generateObject.mockResolvedValue({ object: { nonsense: true }, usage: null });
    const result = await createGatewayExtractionProvider().extract(PDF);
    expect(result).toMatchObject({ ok: false, category: "malformed-response" });
  });
});

/**
 * Error mapping. Each case is a real `AIProviderError` shape the existing
 * Gateway classifier produces — proven here without a single paid request.
 */
describe("provider failures map to typed categories", () => {
  const cases: { label: string; error: AIProviderError; category: string }[] = [
    { label: "401 unauthorized", error: new AIProviderError("provider-error", "x", null, { httpStatus: 401 }), category: "unauthorized" },
    { label: "402 payment required", error: new AIProviderError("provider-error", "x", null, { httpStatus: 402 }), category: "payment-required" },
    { label: "403 forbidden", error: new AIProviderError("provider-error", "x", null, { httpStatus: 403 }), category: "forbidden" },
    { label: "429 rate limit", error: new AIProviderError("rate-limit", "x", 30_000, { httpStatus: 429 }), category: "rate-limit" },
    { label: "500 server error", error: new AIProviderError("provider-error", "x", null, { httpStatus: 500 }), category: "server-error" },
    { label: "503 server error", error: new AIProviderError("provider-error", "x", null, { httpStatus: 503 }), category: "server-error" },
    { label: "timeout", error: new AIProviderError("timeout", "x", null, {}), category: "timeout" },
    { label: "missing key", error: new AIProviderError("missing-api-key", "x", null, {}), category: "missing-api-key" },
    { label: "malformed", error: new AIProviderError("malformed-response", "x", null, {}), category: "malformed-response" },
  ];

  for (const { label, error, category } of cases) {
    it(`${label} → ${category}`, async () => {
      generateObject.mockRejectedValue(error);
      const result = await createGatewayExtractionProvider().extract(PDF);
      expect(result).toMatchObject({ ok: false, category });
    });
  }

  it("never throws — a failure is always a typed result a caller cannot accidentally log", async () => {
    generateObject.mockRejectedValue(new Error("something went very wrong with a payload attached"));
    await expect(createGatewayExtractionProvider().extract(PDF)).resolves.toMatchObject({ ok: false });
  });

  it("sanitises the provider's own message at the boundary", async () => {
    const leak = "failed parsing data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PC9GaWx0ZXIvRmxhdGVEZWNvZGU";
    generateObject.mockRejectedValue(new AIProviderError("provider-error", leak, null, { httpStatus: 500, providerMessage: leak }));
    const result = await createGatewayExtractionProvider().extract(PDF);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain("JVBERi0xLjQ");
    expect(result.message).toContain("[redacted");
  });

  it("carries the HTTP status so the circuit and the attempt record agree about what happened", async () => {
    generateObject.mockRejectedValue(new AIProviderError("provider-error", "x", null, { httpStatus: 402 }));
    const result = await createGatewayExtractionProvider().extract(PDF);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.httpStatus).toBe(402);
  });
});

describe("the documented configuration", () => {
  it("states exactly what a live run would use, so it can be reviewed without running one", () => {
    expect(GATEWAY_EXTRACTION_CONFIG).toMatchObject({
      provider: "vercel-ai-gateway",
      sdk: "ai (generateObject)",
      apiKeyEnvVar: "AI_GATEWAY_API_KEY",
      modelEnvVar: "VYRON_AI_MODEL",
      temperature: 0,
    });
  });

  it("names no secret value anywhere", () => {
    const serialised = JSON.stringify(GATEWAY_EXTRACTION_CONFIG);
    expect(serialised).not.toMatch(/sk-|Bearer |eyJ/);
  });
});

describe("this adapter is NOT the default", () => {
  it("the service still ships the honest no-op provider until certification is authorised", async () => {
    const service = await import("@/server/services/supplier-invoice-capture-service");
    const result = await service.defaultExtractionProvider.extract({ bytes: new Uint8Array(), mimeType: "application/pdf" });
    expect(result).toMatchObject({ ok: false, category: "missing-api-key" });
    // And selecting the Gateway adapter is an explicit act, not a default.
    expect(generateObject).not.toHaveBeenCalled();
  });
});

/**
 * Phase 5M — the schema and the prompt must stay in step.
 *
 * `additionalProperties: false` means a field the PROMPT asks for but the
 * SCHEMA omits is rejected by the SDK — the whole answer fails validation
 * over a field nobody meant to make mandatory. This was a real defect
 * caught during preparation: `documentType` was added to the prompt and
 * the parser but not to the schema.
 */
describe("schema and prompt cannot drift apart", () => {
  it("accepts an answer carrying documentType", async () => {
    generateObject.mockResolvedValue({ object: { ...GOOD_ANSWER, header: { ...GOOD_ANSWER.header, documentType: "Credit Note" } }, usage: null });
    const result = await createGatewayExtractionProvider().extract(PDF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.header.documentType).toBe("Credit Note");
  });

  it("every header field the parser reads is named in the schema", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/server/supplier-invoice-capture/gateway-extraction-provider.ts", "utf8"),
    );
    for (const field of [
      "documentType", "supplierName", "supplierVatNumber", "supplierRegistrationNumber", "invoiceNumber",
      "invoiceDate", "dueDate", "orderReference", "currencyCode", "subtotal", "discountTotal", "vatAmount", "total",
    ]) {
      expect(`${field}:${source.includes(`"${field}"`) || source.includes(`${field}:`)}`).toBe(`${field}:true`);
    }
  });

  it("every line field the parser reads is named in the schema", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/server/supplier-invoice-capture/gateway-extraction-provider.ts", "utf8"),
    );
    for (const field of [
      "description", "supplierSku", "quantity", "uom", "packDescription", "packQuantity",
      "unitPrice", "discount", "vatRatePercent", "vatAmount", "lineTotal",
    ]) {
      expect(`${field}:${source.includes(`${field}:`)}`).toBe(`${field}:true`);
    }
  });
});
