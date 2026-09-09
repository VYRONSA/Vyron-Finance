/**
 * Phase 15 — VYRON AI orchestration. The one place that calls an
 * `AIProvider`, then re-validates and sanitizes whatever it returns
 * before trusting it — "never blindly trust arbitrary provider JSON"
 * (brief, section 13) applies even when the provider implementation
 * already validated its own output (`gateway-provider.ts` does), since
 * this engine must stay correct for ANY `AIProvider` implementation, not
 * just the one shipped today.
 */

import { VYRON_AI_SYSTEM_PROMPT } from "./system-prompt";
import { isValidVyronAiStructuredResponse, sanitizeVyronAiResponse } from "./response-validation";
import { AIProviderError, type AIProvider, type ConversationTurn, type EvidencePackage, type VyronAiStructuredResponse } from "./types";

let defaultProvider: AIProvider | null = null;

/** Lazily constructed via a dynamic import so importing this module —
 * or anything that imports it, including test files — never touches
 * `process.env` or constructs a real provider until a request actually
 * needs one. */
export async function getDefaultAIProvider(): Promise<AIProvider> {
  if (!defaultProvider) {
    const { createGatewayAIProvider } = await import("./providers/gateway-provider");
    defaultProvider = createGatewayAIProvider();
  }
  return defaultProvider;
}

export async function askVyronAi(provider: AIProvider, evidence: EvidencePackage, conversation: ConversationTurn[]): Promise<VyronAiStructuredResponse> {
  if (!evidence.question.trim()) {
    throw new AIProviderError("malformed-response", "No question was supplied.");
  }

  const raw = await provider.generateResponse({ systemPrompt: VYRON_AI_SYSTEM_PROMPT, evidence, conversation });

  if (!isValidVyronAiStructuredResponse(raw)) {
    throw new AIProviderError("malformed-response", "VYRON AI's response did not match the expected structure.");
  }

  return sanitizeVyronAiResponse(raw, evidence);
}
