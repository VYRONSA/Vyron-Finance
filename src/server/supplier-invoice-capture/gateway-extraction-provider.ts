/**
 * Phase 5M — the real provider adapter for supplier-invoice extraction.
 *
 * Phase 5L shipped the interface and the deterministic pipeline but left
 * this unwritten, because writing it without being able to run it once is
 * how you get code that only looks right. It is written now as offline
 * preparation: it compiles, it is exercised against a mocked
 * `generateObject`, and it is NOT the default provider. Nothing selects it
 * until live certification is authorised.
 *
 * It is the SAME Gateway architecture VYRON AI and transaction
 * classification already use — `generateObject` from the `ai` package
 * against the Vercel AI Gateway, `AI_GATEWAY_API_KEY` read by
 * `@ai-sdk/gateway` itself, the model resolved from `VYRON_AI_MODEL` with
 * this project's shared default, and `classifyProviderError` for the error
 * taxonomy. There is deliberately no second provider architecture, no
 * hand-rolled `fetch`, and no provider-specific SDK import — the three
 * things VYRON COST did that cost it its timeout, its backoff and its
 * `Retry-After` handling.
 *
 * Three properties matter more than the code:
 *
 *  1. **The document never leaves this function.** Bytes go in, a parsed
 *     result or a typed error category comes out. Nothing returns, logs or
 *     stores the raw answer, and there is no parameter through which a
 *     caller could ask for one.
 *  2. **The model is told to copy, not calculate** — `EXTRACTION_INSTRUCTION`.
 *  3. **Its answer is structurally validated before it is trusted**, by
 *     the same `parseExtractionResponse` the fixture provider's output goes
 *     through, so a malformed answer is a typed failure rather than a
 *     surprise three layers down.
 */

import { generateObject, jsonSchema, type JSONSchema7 } from "ai";
import { classifyProviderError, DEFAULT_MODEL } from "@/server/ai/providers/gateway-provider";
import {
  EXTRACTION_INSTRUCTION,
  parseExtractionResponse,
  toProviderFailure,
  type ExtractionProvider,
} from "./extraction-provider";
import type { ExtractionInput, ExtractionProviderResult } from "./types";

/**
 * Deliberately longer than VYRON AI's own 25s: reading a dense priced table
 * off a scanned page is a slower job than answering a question about an
 * evidence package. Still bounded — COST had NO transport timeout at all
 * and relied on the platform's 120s function ceiling, which its own worst
 * measured case (119.7s) came within 0.3s of breaching.
 *
 * Extraction runs on the automation runner (`maxDuration = 300`), so this
 * ceiling sits comfortably inside the job's own budget.
 */
export const EXTRACTION_TIMEOUT_MS = 90_000;

/** Bounded so a runaway answer cannot consume the whole budget. Sized for
 * a long invoice: ~40 lines of structured JSON. */
export const EXTRACTION_MAX_OUTPUT_TOKENS = 16_000;

/** What the model may return. Every field nullable, money as numbers, no
 * placeholder strings — the schema itself refuses the shape COST stored
 * `"Needs Review"` into. */
const EXTRACTION_JSON_SCHEMA: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["header", "lines", "invoiceNumbersSeen", "missingFields", "warnings", "declaredLineCount"],
  properties: {
    header: {
      type: "object",
      additionalProperties: false,
      required: [
        "documentType",
        "supplierName", "supplierVatNumber", "supplierRegistrationNumber", "invoiceNumber", "invoiceDate",
        "dueDate", "orderReference", "currencyCode", "subtotal", "discountTotal", "vatAmount", "total", "confidence",
      ],
      properties: {
        // `additionalProperties: false` means a field the prompt asks for
        // but the schema omits is REJECTED, so these two must stay in step.
        documentType: {
          type: ["string", "null"],
          enum: ["Invoice", "Credit Note", "Debit Note", "Other", null],
          description: "What kind of document this is, from the words printed at the top. Never inferred from the amounts.",
        },
        supplierName: nullableString("The business that ISSUED this invoice — never the bill-to party."),
        supplierVatNumber: nullableString("The supplier's VAT registration number, exactly as printed."),
        supplierRegistrationNumber: nullableString("The supplier's company registration number, exactly as printed."),
        invoiceNumber: nullableString("The invoice's own serial number, exactly as printed."),
        invoiceDate: nullableString("ISO YYYY-MM-DD, or null if not clearly printed."),
        dueDate: nullableString("ISO YYYY-MM-DD, or null."),
        orderReference: nullableString("Purchase order or reference printed on the invoice."),
        currencyCode: nullableString("ISO currency code, e.g. ZAR."),
        subtotal: nullableNumber("The total excluding VAT, as printed. Never computed."),
        discountTotal: nullableNumber("Total discount, only if printed as its own figure."),
        vatAmount: nullableNumber("The VAT total, as printed. Never computed from a rate."),
        total: nullableNumber("The invoice total including VAT, as printed."),
        confidence: nullableNumber("0-100. Informative only."),
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "description", "supplierSku", "quantity", "uom", "packDescription", "packQuantity",
          "unitPrice", "discount", "vatRatePercent", "vatAmount", "lineTotal", "confidence",
        ],
        properties: {
          description: nullableString("The line's description, exactly as printed."),
          supplierSku: nullableString("The supplier's own product code for this line."),
          quantity: nullableNumber("As printed."),
          uom: nullableString("Unit of measure as printed, e.g. each, kg, case."),
          packDescription: nullableString("A pack expression only if literally printed, e.g. '12 x 1L'."),
          packQuantity: nullableNumber("The multiplier from packDescription, only if unambiguous."),
          unitPrice: nullableNumber("As printed. Never derived from a total."),
          discount: nullableNumber("Money off this line, only if printed."),
          vatRatePercent: nullableNumber("Only if a rate is printed on the line."),
          vatAmount: nullableNumber("As printed. Never computed from a rate."),
          lineTotal: nullableNumber("As printed. Never derived from quantity x price."),
          confidence: nullableNumber("0-100. Informative only."),
        },
      },
    },
    invoiceNumbersSeen: {
      type: "array",
      items: { type: "string" },
      description: "Every DISTINCT invoice number appearing anywhere in the file. A file may hold several invoices; report them all rather than merging them.",
    },
    missingFields: { type: "array", items: { type: "string" }, description: "Names of fields that could not be read." },
    warnings: { type: "array", items: { type: "string" } },
    declaredLineCount: nullableNumber("How many charged lines you can see, counted before extracting."),
  },
};

function nullableString(description: string): JSONSchema7 {
  return { type: ["string", "null"], description };
}

function nullableNumber(description: string): JSONSchema7 {
  return { type: ["number", "null"], description };
}

/** Which content part the SDK needs. A PDF is a file; an image is an
 * image. Getting this wrong is silent — the model receives something it
 * cannot read and confidently describes nothing. */
function documentPart(input: ExtractionInput) {
  if (input.mimeType === "application/pdf") {
    return { type: "file" as const, data: input.bytes, mediaType: "application/pdf" };
  }
  return { type: "image" as const, image: input.bytes, mediaType: input.mimeType };
}

/**
 * The Gateway-backed extraction provider.
 *
 * Constructed lazily by the caller, never at module import time, so
 * importing this file never touches `process.env` or the network — the
 * same discipline `createGatewayAIProvider` documents, and what keeps the
 * whole suite safe to run without a key.
 */
export function createGatewayExtractionProvider(): ExtractionProvider {
  return {
    async extract(input: ExtractionInput): Promise<ExtractionProviderResult> {
      const model = process.env.VYRON_AI_MODEL || DEFAULT_MODEL;

      // Phase 5N — fail closed before any network activity, exactly as
      // `createGatewayTransactionClassificationProvider` does and for the
      // same reason: without the configured key the Gateway SDK falls back
      // to another credential (a Vercel OIDC token) and SENDS THE REQUEST
      // ANYWAY. A document would leave the building on a credential nobody
      // chose. `provider-selection.ts` already refuses this case before
      // reaching here; this is the second lock, on the door itself.
      if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
        return {
          ok: false,
          category: "missing-api-key",
          httpStatus: null,
          message: "AI_GATEWAY_API_KEY is not configured on this server; no request was sent.",
          model: null,
        };
      }

      try {
        const { object, usage } = await generateObject({
          model,
          schema: extractionSchema(),
          schemaName: "SupplierInvoiceExtraction",
          schemaDescription: "Everything printed on one supplier invoice, copied exactly.",
          instructions: EXTRACTION_INSTRUCTION,
          messages: [
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: "Read this supplier invoice." },
                documentPart(input),
              ],
            },
          ],
          maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
          // Deterministic: the same document should give the same answer.
          // COST measured two runs of the same page returning 109.50 and
          // 97.14 as the same unit price at temperature 0, so this is not
          // a guarantee — but a non-zero temperature guarantees the
          // opposite.
          temperature: 0,
          abortSignal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
        });

        const result = parseExtractionResponse(object);
        if (!result) {
          return {
            ok: false,
            category: "malformed-response",
            httpStatus: null,
            message: "The model's answer did not match the expected shape.",
            model,
          };
        }

        return {
          ok: true,
          result,
          model,
          usage: usage
            ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens }
            : null,
        };
      } catch (error) {
        // `classifyProviderError` recovers the HTTP status and a real
        // `Retry-After` from the Gateway's own response headers;
        // `toProviderFailure` maps it to this feature's categories and
        // sanitises the message at the boundary, so nothing downstream
        // ever holds an unsanitised provider string.
        return toProviderFailure(classifyProviderError(error), model);
      }
    },
  };
}

/** Structural validation as a schema-level concern, mirroring
 * `gateway-provider.ts::responseSchema`. An answer that does not parse is
 * rejected by the SDK before it reaches this feature's logic. */
function extractionSchema() {
  return jsonSchema<unknown>(EXTRACTION_JSON_SCHEMA, {
    validate: (value) =>
      parseExtractionResponse(value)
        ? { success: true as const, value }
        : { success: false as const, error: new Error("Supplier invoice extraction failed structural validation.") },
  });
}

/** Exported for the certification report and for review — the exact
 * configuration a live run would use, without needing to run one. */
export const GATEWAY_EXTRACTION_CONFIG = {
  provider: "vercel-ai-gateway",
  sdk: "ai (generateObject)",
  modelEnvVar: "VYRON_AI_MODEL",
  defaultModel: DEFAULT_MODEL,
  apiKeyEnvVar: "AI_GATEWAY_API_KEY",
  structuredOutput: "jsonSchema + SDK-level validate()",
  timeoutMs: EXTRACTION_TIMEOUT_MS,
  maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
  temperature: 0,
  documentHandling: "PDF as a file part; JPG/PNG as an image part. Bytes are passed straight through — never base64-logged.",
} as const;
