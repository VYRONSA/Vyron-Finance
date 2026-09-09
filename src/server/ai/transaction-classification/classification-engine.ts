/**
 * Phase 22A — the one place that calls a `TransactionClassificationProvider`
 * and then re-validates whatever it returns before trusting it, mirroring
 * `../vyron-ai-engine.ts`'s own discipline: never blindly trust arbitrary
 * provider JSON, even structurally-valid JSON. The specific defense here
 * is stronger than VYRON AI's — an `accountCode` the model returns that
 * isn't one of the `candidateAccounts` this exact call offered is treated
 * as a hallucination and discarded (never persisted, never presented to
 * the user), not merely sanitized.
 */

import { AIProviderError } from "@/server/ai/types";
import type { TransactionClassificationEvidence, TransactionClassificationProvider, TransactionClassificationResult } from "./types";
import { confidenceLevelFor } from "./types";
import { assessAccountingConfidence } from "./accounting-confidence";
import { evidenceFromAiPatterns } from "./company-historical-evidence";

let defaultProvider: TransactionClassificationProvider | null = null;

/** Lazily constructed via a dynamic import — importing this module (or
 * anything that imports it, including test files) never touches
 * `process.env` or constructs a real provider until a classification is
 * actually requested. Same pattern as `getDefaultAIProvider()`. */
export async function getDefaultTransactionClassificationProvider(): Promise<TransactionClassificationProvider> {
  if (!defaultProvider) {
    const { createGatewayTransactionClassificationProvider } = await import("./providers/gateway-classification-provider");
    defaultProvider = createGatewayTransactionClassificationProvider();
  }
  return defaultProvider;
}

/** Test-only escape hatch — mirrors no equivalent in `vyron-ai-engine.ts`
 * (which takes the provider as a parameter instead), needed here because
 * `transaction-classification-service.ts` calls
 * `getDefaultTransactionClassificationProvider()` itself rather than
 * receiving a provider from its own caller (the import pipeline has no
 * reason to know about AI providers at all). */
export function __setTransactionClassificationProviderForTests(provider: TransactionClassificationProvider | null): void {
  defaultProvider = provider;
}

export async function classifyTransactionWithAi(provider: TransactionClassificationProvider, evidence: TransactionClassificationEvidence): Promise<TransactionClassificationResult> {
  const raw = await provider.classify(evidence);

  const modelUsed = process.env.VYRON_AI_MODEL || "openai/gpt-4o-mini";

  // The hallucination defense: an accountCode the model invents, that
  // was never in the candidates THIS call offered, is never trusted —
  // collapsed to the same honest "could not classify" outcome as a
  // genuine `null` response, never silently substituted or corrected.
  const isValidCandidate = raw.accountCode !== null && evidence.candidateAccounts.some((a) => a.accountCode === raw.accountCode);

  if (raw.accountCode !== null && !isValidCandidate) {
    throw new AIProviderError("malformed-response", "The classification model suggested an account that was not one of the candidates offered.");
  }

  const confidence = raw.accountCode === null ? 0 : Math.max(0, Math.min(100, raw.confidence));

  // Phase 28 — the accounting-evidence-based assessment, computed from
  // this company's own real historical pattern data (already fetched by
  // `evidence-builder.ts` and threaded through on `evidence` itself, so
  // this never issues a second database query for the same evidence —
  // see `evidenceFromAiPatterns`'s own docstring). This is what the rest
  // of the pipeline (`transaction-classification-service.ts::classifyOne`)
  // now decides on, never the model's raw `confidence` alone.
  const accountingConfidence = assessAccountingConfidence(
    { accountCode: raw.accountCode, confidence },
    evidenceFromAiPatterns(evidence.companyHistoricalPatterns),
  );

  return {
    transactionId: evidence.transactionId,
    companyId: evidence.companyId,
    accountCode: raw.accountCode,
    confidence,
    confidenceLevel: confidenceLevelFor(confidence),
    explanation: raw.explanation.trim(),
    modelUsed,
    accountingConfidence,
  };
}
