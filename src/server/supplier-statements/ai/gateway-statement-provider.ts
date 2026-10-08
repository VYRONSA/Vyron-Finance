/**
 * SD-3F — the AI Gateway adapter for scanned supplier statements.
 *
 * NOT selected unless VYRON_AI_STATEMENT_EXTRACTION=certification AND a key is
 * configured (`selectStatementProvider`), and it checks the key AGAIN before
 * any network activity — without the configured key the Gateway SDK would
 * fall back to another credential and send the document anyway.
 *
 * Same architecture as the invoice adapter: `generateObject` against the
 * Vercel AI Gateway, a strict JSON schema with SDK-level validation, a
 * bounded timeout and output, temperature 0, and the shared error taxonomy.
 * The document's bytes go in; a structurally valid TRANSCRIPTION (text only)
 * or a typed failure comes out. The raw answer is never returned, logged or
 * stored.
 */
import { generateObject, jsonSchema, type JSONSchema7 } from "ai";
import { classifyProviderError, DEFAULT_MODEL } from "@/server/ai/providers/gateway-provider";
import { toProviderFailure } from "@/server/supplier-invoice-capture/extraction-provider";
import {
  parseStatementTranscription,
  STATEMENT_AI_API_KEY_ENV_VAR,
  STATEMENT_TRANSCRIPTION_INSTRUCTION,
  type StatementDocument,
  type StatementExtractionProvider,
  type StatementProviderResult,
} from "./statement-ai-provider";

export const STATEMENT_AI_TIMEOUT_MS = 120_000;
export const STATEMENT_AI_MAX_OUTPUT_TOKENS = 32_000;

const text = (description: string): JSONSchema7 => ({ type: ["string", "null"], description });

/** Every value is TEXT. There is no number field a model could calculate into. */
export const STATEMENT_TRANSCRIPTION_SCHEMA: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: [
    "supplierName", "supplierVatNumber", "supplierRegistrationNumber", "accountNumber", "statementDateText", "periodText",
    "currencyText", "openingBalanceText", "closingBalanceText", "rows", "declaredTransactionRows", "warnings",
  ],
  properties: {
    supplierName: text("The business that ISSUED the statement, exactly as printed."),
    supplierVatNumber: text("The supplier's VAT number, exactly as printed."),
    supplierRegistrationNumber: text("The supplier's company registration number, exactly as printed."),
    accountNumber: text("The customer's account number at the supplier, exactly as printed (keep leading zeros)."),
    statementDateText: text("The statement date exactly as printed."),
    periodText: text("The statement period exactly as printed."),
    currencyText: text("A currency code or symbol only if printed."),
    openingBalanceText: text("The opening / brought-forward balance exactly as printed. Never computed."),
    closingBalanceText: text("The closing balance / amount due exactly as printed. Never computed."),
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "dateText", "referenceText", "description", "typeText", "debitText", "creditText", "amountText", "balanceText", "rowText"],
        properties: {
          page: { type: ["integer", "null"], description: "The page the row is on (1-based)." },
          dateText: text("The row's date exactly as printed."),
          referenceText: text("The reference / document number exactly as printed — leading zeros kept."),
          description: text("The row's description as printed."),
          typeText: text("A type code or word only if printed (e.g. INV, CN, PMT)."),
          debitText: text("The debit column's text exactly as printed, or null."),
          creditText: text("The credit column's text exactly as printed, or null."),
          amountText: text("For a single amount column: its text exactly as printed, signs included."),
          balanceText: text("The running balance's text exactly as printed, or null."),
          rowText: { type: "string", description: "The whole row as it reads on the page." },
        },
      },
    },
    declaredTransactionRows: { type: ["integer", "null"], description: "How many transaction rows the statement shows, counted before transcribing." },
    warnings: { type: "array", items: { type: "string" } },
  },
};

function documentPart(document: StatementDocument) {
  if (document.mimeType === "application/pdf") return { type: "file" as const, data: document.bytes, mediaType: "application/pdf" };
  return { type: "image" as const, image: document.bytes, mediaType: document.mimeType };
}

export function createGatewayStatementProvider(): StatementExtractionProvider {
  return {
    name: "gateway",
    async transcribe(document: StatementDocument): Promise<StatementProviderResult> {
      const model = process.env.VYRON_AI_MODEL || DEFAULT_MODEL;
      // The second lock, on the door itself: no configured key, no request.
      if (!process.env[STATEMENT_AI_API_KEY_ENV_VAR]?.trim()) {
        return { ok: false, category: "missing-api-key", httpStatus: null, message: `${STATEMENT_AI_API_KEY_ENV_VAR} is not configured on this server; no request was sent.`, model: null };
      }
      try {
        const { object, usage } = await generateObject({
          model,
          schema: jsonSchema<unknown>(STATEMENT_TRANSCRIPTION_SCHEMA, {
            validate: (value) =>
              parseStatementTranscription(value)
                ? { success: true as const, value }
                : { success: false as const, error: new Error("Supplier statement transcription failed structural validation.") },
          }),
          schemaName: "SupplierStatementTranscription",
          schemaDescription: "Everything printed on one supplier statement, copied exactly as text.",
          instructions: STATEMENT_TRANSCRIPTION_INSTRUCTION,
          messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Transcribe this supplier statement." }, documentPart(document)] }],
          maxOutputTokens: STATEMENT_AI_MAX_OUTPUT_TOKENS,
          temperature: 0,
          abortSignal: AbortSignal.timeout(STATEMENT_AI_TIMEOUT_MS),
        });
        const transcription = parseStatementTranscription(object);
        if (!transcription) return { ok: false, category: "malformed-response", httpStatus: null, message: "The model's answer did not match the expected shape.", model };
        return {
          ok: true,
          transcription,
          model,
          usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } : null,
        };
      } catch (error) {
        return toProviderFailure(classifyProviderError(error), model);
      }
    },
  };
}
