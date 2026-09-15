/**
 * Phase 22A — the ONE production `TransactionClassificationProvider`.
 * Mirrors `../../providers/gateway-provider.ts` exactly: `generateObject`
 * against the Vercel AI Gateway, `VYRON_AI_MODEL` (falling back to the
 * SAME `DEFAULT_MODEL` VYRON AI itself uses — imported, not restated),
 * the same request timeout, and the same `classifyProviderError` used
 * for VYRON AI — no second AI provider, no vendor SDK, no hardcoded
 * model.
 */

import { generateObject, jsonSchema, type JSONSchema7 } from "ai";
import { DEFAULT_MODEL, REQUEST_TIMEOUT_MS, classifyProviderError } from "@/server/ai/providers/gateway-provider";
import type { RawTransactionClassification, TransactionClassificationEvidence, TransactionClassificationProvider } from "../types";
import { extractProviderUsage } from "../safety-policy";
import { AIProviderError } from "@/server/ai/types";

const CLASSIFICATION_JSON_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    accountCode: {
      type: ["string", "null"],
      description: "The accountCode of the single best-fitting account from the supplied candidateAccounts list, or null if none confidently fits.",
    },
    confidence: { type: "number", minimum: 0, maximum: 100, description: "Your own certainty in this suggestion, 0-100. Use 0 when accountCode is null." },
    explanation: { type: "string", description: "One or two plain-language sentences a bookkeeper would find useful. Never restate your internal reasoning process — state the conclusion." },
  },
  required: ["accountCode", "confidence", "explanation"],
  additionalProperties: false,
};

function classificationSchema() {
  return jsonSchema<RawTransactionClassification>(CLASSIFICATION_JSON_SCHEMA);
}

const SYSTEM_PROMPT = [
  "You are VYRON AI, helping classify one bank transaction to the correct general ledger account for a South African accounting system.",
  "You may choose ONLY from the accountCode values listed in candidateAccounts — never invent an account code that isn't in that list.",
  "candidateAccounts may include Asset, Liability, and Equity accounts (for example a loan repayment, an owner drawing, a fixed asset purchase, or a statutory payable like PAYE/UIF/SDL) alongside Income/Expense accounts — choose whichever genuinely fits the transaction; never force an Income/Expense guess when a Balance Sheet account is the correct classification.",
  "If nothing in candidateAccounts confidently fits this transaction, return accountCode: null and confidence: 0 — never guess.",
  "similarPastClassifications, when present, shows how this exact company has classified this exact beneficiary before — weigh it heavily, especially entries where wasManuallyConfirmed is true.",
  // Phase 28 — the forensic report's central production defect: the
  // model repeatedly reasoned that bank-narration boilerplate like "FNB
  // OB Pmt" itself indicated a bank fee, when it is only the bank's own
  // payment-channel label ("this payment was made via online banking")
  // and says nothing about who it went to or why. These two lines exist
  // specifically to prevent that exact class of mistake.
  "Generic bank narration prefixes and codes (for example \"FNB OB Pmt\", \"Magtape Debit\", bank reference numbers) describe HOW a payment was made, never WHY, and are never evidence on their own that a transaction is a bank fee, charge, or any other specific classification — do not reason from the narration text alone.",
  "companyHistoricalPatterns, when present, shows how THIS company has actually classified structurally similar transactions before (same narration type, amount range, and direction) even when the exact beneficiary differs — humanConfirmedCount is a human-confirmed decision (far stronger evidence than your own reasoning), aiOnlyCount is merely a prior unconfirmed AI guess (weak evidence, never treat it as established fact). When a company historical pattern has a real humanConfirmedCount for one account, that is stronger evidence than a generic narration-based guess — prefer it, and if your own instinct disagrees with it, say so honestly in your explanation rather than ignoring the pattern.",
  "Write your explanation as a bookkeeper would — cite the actual evidence (the transaction's own supplier/beneficiary detail, similarPastClassifications, or companyHistoricalPatterns) that supports your answer, never a generic claim about what a narration prefix 'typically' or 'usually' means.",
  "Never claim certainty the evidence doesn't support.",
].join(" ");

/** Lazily constructed by `getDefaultTransactionClassificationProvider()`
 * (`../classification-engine.ts`) — same "never touch `process.env` or
 * the network at import time" discipline as `createGatewayAIProvider`. */
export function createGatewayTransactionClassificationProvider(): TransactionClassificationProvider {
  return {
    async classify(evidence: TransactionClassificationEvidence) {
      // Fail closed before any network activity: without the configured key
      // the Gateway SDK would fall back to another credential (a Vercel OIDC
      // token) and still send the request.
      if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
        throw new AIProviderError("missing-api-key", "VYRON AI's provider is not configured (missing API key).", null, {
          providerMessage: "AI_GATEWAY_API_KEY is not configured on this server; no request was sent.",
        });
      }
      try {
        const { object, usage, providerMetadata } = await generateObject({
          model: process.env.VYRON_AI_MODEL || DEFAULT_MODEL,
          schema: classificationSchema(),
          schemaName: "TransactionClassification",
          schemaDescription: "The best-fitting general ledger account for one bank transaction, chosen only from the supplied candidates.",
          instructions: SYSTEM_PROMPT,
          messages: [{ role: "user" as const, content: `Transaction and candidate accounts (the ONLY accounts you may choose from), as JSON:\n${JSON.stringify(evidence)}` }],
          abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          // One attempt = exactly one provider request. The SDK's own default
          // (2 silent retries) tripled requests on 429/5xx and made them
          // invisible; retries are now the classification queue's decision.
          maxRetries: 0,
        });
        return { ...object, usage: extractProviderUsage(usage, providerMetadata) };
      } catch (error) {
        throw classifyProviderError(error);
      }
    },
  };
}
