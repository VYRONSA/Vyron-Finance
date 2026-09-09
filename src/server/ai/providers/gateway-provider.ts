/**
 * Phase 15 — the ONE production `AIProvider` implementation (brief,
 * section 3). Uses the Vercel AI SDK's `generateObject` against the
 * Vercel AI Gateway, which is this project's existing platform
 * (confirmed via `.vercel/project.json` and `.env.local.example`'s own
 * "Provisioned via Vercel Marketplace integration" convention for
 * Stripe) — no provider-specific SDK (`@ai-sdk/anthropic`,
 * `@ai-sdk/openai`, ...) is installed or imported here, so switching
 * models/vendors is a one-line env var change (`VYRON_AI_MODEL`), never
 * a code change (brief, section 2: "the provider must be replaceable").
 *
 * The API key (`AI_GATEWAY_API_KEY` — the real, existing env var name
 * `@ai-sdk/gateway` itself already reads by default; no project-specific
 * naming convention existed to reuse, so this project's own dependency's
 * own convention was used instead of inventing `VYRON_AI_API_KEY`) never
 * leaves the server: this file only runs in `src/server/**`, and the
 * `ai` package's `generateObject` call happens entirely server-side.
 */

import { APICallError, generateObject, jsonSchema, type JSONSchema7 } from "ai";
import { AIProviderError, type AIProvider, type ConversationTurn, type VyronAiStructuredResponse } from "../types";
import { isValidVyronAiStructuredResponse } from "../response-validation";

/** Sensible default (brief, section 20) — overridable per-environment
 * via `VYRON_AI_MODEL` without any code change. A Gateway model string,
 * never a hard-coded vendor SDK call.
 *
 * Phase 18B — was `anthropic/claude-sonnet-4-5`; the Phase 18 QA audit's
 * live Gateway test proved that model returns "Free tier users do not
 * have access to this model" on the account behind the current
 * `AI_GATEWAY_API_KEY` (the key itself authenticates fine — confirmed
 * separately). `openai/gpt-4o-mini` was confirmed, live, to work on that
 * same account, so it's the new default — still just a string this
 * account's plan can reach today, not a permanent vendor commitment.
 * `VYRON_AI_MODEL` always wins when set, on any account/tier.
 *
 * Exported (Phase 22A) so other Gateway-based `AIProvider`-family
 * implementations — e.g. `transaction-classification/providers/
 * gateway-classification-provider.ts` — resolve the SAME model/default
 * VYRON AI itself uses, rather than restating this string a second time
 * and risking the two silently drifting apart. */
export const DEFAULT_MODEL = "openai/gpt-4o-mini";

/** Request-level timeout (brief, section 19: "provider timeout" must be
 * handled). Deliberately generous for a reasoning model, short enough
 * that a hung request can't hold a user's browser open indefinitely.
 * Exported for the same reason as `DEFAULT_MODEL` above. */
export const REQUEST_TIMEOUT_MS = 25_000;

/** Only the last few turns — bounds prompt size/cost (brief, section 26)
 * and is enough for "tell me more about the first one"-style continuity
 * (brief, section 16) without needing the full session history. */
const MAX_CONVERSATION_TURNS = 6;

const RESPONSE_JSON_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    answer: { type: "string", description: "The direct answer to the user's question, in plain language." },
    keyPoints: { type: "array", items: { type: "string" } },
    evidenceReferences: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, href: { type: ["string", "null"] } },
        required: ["label", "href"],
        additionalProperties: false,
      },
    },
    recommendedActions: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, href: { type: "string" } },
        required: ["label", "href"],
        additionalProperties: false,
      },
    },
    uncertainties: { type: "array", items: { type: "string" }, description: "Anything the evidence doesn't fully support, stated honestly." },
  },
  required: ["answer", "keyPoints", "evidenceReferences", "recommendedActions", "uncertainties"],
  additionalProperties: false,
};

function responseSchema() {
  return jsonSchema<VyronAiStructuredResponse>(RESPONSE_JSON_SCHEMA, {
    validate: (value) => (isValidVyronAiStructuredResponse(value) ? { success: true, value } : { success: false, error: new Error("VYRON AI response failed structural validation.") }),
  });
}

/** Phase 26I — the Gateway (`@ai-sdk/gateway`) attaches every real
 * response header, verbatim, to the `APICallError` it throws on a
 * non-2xx response (`responseHeaders: Object.fromEntries([...response.headers])`).
 * On a 429 that includes a standard `Retry-After` header expressed as
 * delay-seconds (the convention OpenAI/the Gateway actually use — never
 * the alternative HTTP-date form, which `Number(...)` correctly rejects
 * as `NaN` and this then safely ignores), this recovers the provider's
 * own stated cooldown so callers can honor EXACTLY that instead of a
 * blind fixed guess. Returns `null` — never a fabricated number — for
 * any error shape or header this can't confidently parse. */
function extractRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof APICallError)) return null;
  const header = error.responseHeaders?.["retry-after"];
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

/** Maps every SDK/network failure mode (brief, section 19) into one of
 * this module's typed error codes — callers never see a raw provider
 * stack trace or vendor-specific error class. */
export function classifyProviderError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";

  if (/AI_GATEWAY_API_KEY|api ?key|unauthorized|401/i.test(message)) {
    return new AIProviderError("missing-api-key", "VYRON AI's provider is not configured (missing API key).");
  }
  if (name === "AbortError" || name === "TimeoutError" || /aborted|timed? ?out/i.test(message)) {
    return new AIProviderError("timeout", "VYRON AI's provider did not respond in time.");
  }
  if (/rate.?limit|429|too many requests/i.test(message)) {
    return new AIProviderError("rate-limit", "VYRON AI's provider rate limit was reached.", extractRetryAfterMs(error));
  }
  if (/no object generated|schema|json|validation/i.test(message)) {
    return new AIProviderError("malformed-response", "VYRON AI's provider returned a response that could not be understood.");
  }
  return new AIProviderError("provider-error", "VYRON AI's provider returned an error.");
}

function toModelMessages(conversation: ConversationTurn[]) {
  return conversation.slice(-MAX_CONVERSATION_TURNS).map((turn) => ({ role: turn.role, content: turn.content }));
}

/** The one production provider. Constructed lazily by
 * `getDefaultAIProvider()` (vyron-ai-engine.ts) — never at module import
 * time — so importing this file (or anything that transitively imports
 * it) never touches `process.env` or the network by itself, which is
 * what keeps every test in this codebase safe to run without a real key
 * (brief, section 23: "never call the real provider in tests"). */
export function createGatewayAIProvider(): AIProvider {
  return {
    async generateResponse({ systemPrompt, evidence, conversation }) {
      try {
        const { object } = await generateObject({
          model: process.env.VYRON_AI_MODEL || DEFAULT_MODEL,
          schema: responseSchema(),
          schemaName: "VyronAiAnswer",
          schemaDescription: "VYRON AI's evidence-grounded answer to a question about the company's financial intelligence.",
          instructions: systemPrompt,
          messages: [
            ...toModelMessages(conversation),
            { role: "user" as const, content: `Evidence Package (the ONLY financial data you may use, as JSON):\n${JSON.stringify(evidence)}\n\nQuestion: ${evidence.question}` },
          ],
          abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        return object;
      } catch (error) {
        throw classifyProviderError(error);
      }
    },
  };
}
