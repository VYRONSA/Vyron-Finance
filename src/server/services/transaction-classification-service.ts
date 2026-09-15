/**
 * Phase 22A — AI Transaction Classification orchestrator. The ONE place
 * that decides WHICH transactions are eligible for an AI suggestion,
 * calls the classification model for each, and writes the result via
 * the existing allocation-history-backed repository path
 * (`applyAiClassification`). Never creates a journal, never touches
 * Banking Rules, Banking Exceptions, or the Posting Engine — every
 * suggestion/allocation this writes is read by all of those exactly the
 * way a Banking Rule's own GL-only match already is. AI classification
 * only ever SUGGESTS an account: it never posts, reconciles, changes
 * amounts/VAT/source data, deletes transactions or alters an existing
 * allocation.
 *
 * PRECEDENCE MODEL (Phase 22A): AI classification runs ONLY on a
 * transaction the Rule Engine and Matching Engine left completely
 * untouched — see `isEligibleForAiClassification` in
 * `@/server/ai/transaction-classification/types`, the ONE shared
 * eligibility check every caller uses.
 *
 * Entry points: `classifyUnallocatedTransactionsWithAi` (automatic, after
 * an import/bank sync, and the core of the sweep),
 * `classifyTransactionsWithAiManual` (the user's explicit "Classify with
 * AI", which is also the explicit "Retry AI" for a transaction the sweep
 * has stopped selecting) and `runAutomaticAiClassificationSweep` (the
 * scheduler's `AiClassificationSweep` task). All three reach the provider
 * only through `runClassificationBatch`, and only after the gate.
 *
 * Phase 28 — High-confidence automatic allocation stays PAUSED
 * (`AUTO_ALLOCATE_HIGH_CONFIDENCE`); accounting confidence, not the
 * model's own confidence, decides whether a suggestion is written.
 *
 * AI SAFETY (migration 0099, after the 2026-09-15 production
 * investigation — the sweep had re-asked the AI about the same 20
 * transactions every ~2 minutes, ~11,000 requests/day):
 *  - Before EVERY provider request the gate is checked for that
 *    transaction: automatic paths skip a transaction in cooldown, awaiting
 *    human review or already resolved; while the provider circuit is open
 *    nothing is sent (except one probe when due); and one of the company's
 *    `AI_PROVIDER_DAILY_REQUEST_CAP` daily requests is reserved atomically.
 *    Only an explicit allow/probe decision lets a request through.
 *  - Every attempt is recorded (`ai_classification_attempts`) with its
 *    outcome, error category, HTTP status, sanitized provider message and
 *    any usage the provider reported; each actual provider request also
 *    counts in the internal `ai_provider_requests` metric.
 *  - Each transaction's queue state is updated with the attempt: a first
 *    no-confidence/invalid answer puts it into a 7-day cooldown, a second
 *    one into "needs human review" (never selected automatically again).
 *  - The first provider-level failure (auth/config, timeout, 5xx/network,
 *    429) stops the batch — the remaining transactions are not sent.
 *  - If the safety store can't be reached or an attempt can't be
 *    recorded, nothing more is sent (fail closed).
 */

import { getTransactionsByIds, applyAiClassification } from "@/server/repositories/transaction-explorer-repository";
import { buildTransactionClassificationEvidence } from "@/server/ai/transaction-classification/evidence-builder";
import { classifyTransactionWithAi, getDefaultTransactionClassificationProvider } from "@/server/ai/transaction-classification/classification-engine";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import { isEligibleForAiClassification } from "@/server/ai/transaction-classification/types";
import { isHeldForHumanReview, type BankTransactionRecord } from "@/server/accounting/types";
import type { TransactionClassificationProvider, TransactionClassificationResult } from "@/server/ai/transaction-classification/types";
import {
  gateAiProviderRequest,
  listAiClassificationSweepCandidates,
  recordAiClassificationAttempt,
} from "@/server/repositories/ai-classification-safety-repository";
import {
  AI_PROVIDER_DAILY_REQUEST_CAP,
  classifyClassificationFailure,
  sanitizeProviderMessage,
  type AttemptOutcome,
  type AttemptSource,
  type CircuitSignal,
  type ProviderErrorCategory,
  type ProviderUsage,
} from "@/server/ai/transaction-classification/safety-policy";

/** Bounds cost/latency per run. Shared by the automatic paths and the
 * manual action. Exported so the API route can compute the combined
 * batch/usage-limit cap without guessing this value. */
export const MAX_AI_CLASSIFICATIONS_PER_RUN = 20;

type ClassifyOneStatus = "classified" | "allocated" | "no-confident-suggestion" | "failed" | "rate-limited";

/** Phase 28, Part 1 — PRODUCTION SAFETY PAUSE, temporary and reversible:
 * the model's self-reported confidence is not VYRON's accounting
 * confidence, so a High result is written as 'Suggested', never an
 * unattended 'Allocated'. */
const AUTO_ALLOCATE_HIGH_CONFIDENCE = false;

function targetStatusFor(accountingConfidenceLevel: TransactionClassificationResult["accountingConfidence"]["accountingConfidenceLevel"]): "Suggested" | "Allocated" {
  return accountingConfidenceLevel === "High" && AUTO_ALLOCATE_HIGH_CONFIDENCE ? "Allocated" : "Suggested";
}

/** Phase 28, Part 8 — Low accounting confidence is treated exactly like
 * "no confident suggestion": nothing is written. */
function isAccountingConfidenceSufficientToSuggest(accountingConfidenceLevel: TransactionClassificationResult["accountingConfidence"]["accountingConfidenceLevel"]): boolean {
  return accountingConfidenceLevel !== "Low";
}

/** Phase 28, Part 11 — the stored explanation leads with the
 * accounting-evidence reasoning; the model's own reasoning is only
 * appended, labelled as unverified, when there is no strong evidence. */
function explanationFor(result: TransactionClassificationResult): string {
  const { accountingConfidence } = result;
  if (accountingConfidence.evidenceStrength === "None" || accountingConfidence.evidenceStrength === "Weak") {
    return `${accountingConfidence.explanation} The AI's own stated reasoning (not independently verified against this company's history): "${result.explanation}"`;
  }
  return accountingConfidence.explanation;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The transaction's own details, removed from any error text we keep. */
function sensitiveValuesOf(transaction: BankTransactionRecord): string[] {
  return [transaction.description, transaction.beneficiary, transaction.reference].filter((v): v is string => typeof v === "string" && v.trim().length >= 4);
}

/** Everything one attempt produced — what gets recorded and tallied. */
type AttemptResult = {
  status: ClassifyOneStatus;
  outcome: AttemptOutcome;
  providerRequestMade: boolean;
  /** Stop the batch: the next request would very likely fail the same way. */
  providerLevelFailure: boolean;
  circuitSignal: CircuitSignal;
  errorCategory: ProviderErrorCategory | null;
  httpStatus: number | null;
  /** Sanitized. */
  providerMessage: string | null;
  /** Bounded. */
  retryAfterMs: number | null;
  usage: ProviderUsage | null;
  model: string | null;
};

/** One transaction: build evidence, ask the provider once, validate, and
 * write a suggestion when accounting confidence allows. Never throws —
 * every failure becomes a categorized result. */
async function classifyOne(companyId: string, transaction: BankTransactionRecord, provider: TransactionClassificationProvider, performedBy: string): Promise<AttemptResult> {
  const sensitive = sensitiveValuesOf(transaction);
  const base: AttemptResult = {
    status: "failed",
    outcome: "provider_error",
    providerRequestMade: false,
    providerLevelFailure: false,
    circuitSignal: "none",
    errorCategory: null,
    httpStatus: null,
    providerMessage: null,
    retryAfterMs: null,
    usage: null,
    model: process.env.VYRON_AI_MODEL || "openai/gpt-4o-mini",
  };

  let evidence;
  try {
    evidence = await buildTransactionClassificationEvidence(companyId, transaction);
  } catch (error) {
    // No provider request was made: a database/evidence failure is never
    // counted as one.
    return { ...base, outcome: "evidence_error", providerMessage: sanitizeProviderMessage(errorMessageOf(error), sensitive) };
  }

  let result: TransactionClassificationResult;
  try {
    result = await classifyTransactionWithAi(provider, evidence);
  } catch (error) {
    const failure = classifyClassificationFailure(error, sensitive);
    const invalid = failure.category === "malformed-response" || failure.category === "invalid-suggestion";
    return {
      ...base,
      status: failure.category === "rate-limit" ? "rate-limited" : "failed",
      outcome: invalid ? "invalid_response" : "provider_error",
      providerRequestMade: failure.providerRequestMade,
      providerLevelFailure: failure.providerLevel,
      circuitSignal: failure.circuitSignal,
      errorCategory: failure.category,
      httpStatus: failure.httpStatus,
      providerMessage: failure.providerMessage,
      retryAfterMs: failure.retryAfterMs,
    };
  }

  const answered: AttemptResult = { ...base, providerRequestMade: true, circuitSignal: "success", usage: result.usage ?? null, model: result.modelUsed };

  if (result.accountCode === null || !isAccountingConfidenceSufficientToSuggest(result.accountingConfidence.accountingConfidenceLevel)) {
    return { ...answered, status: "no-confident-suggestion", outcome: "no_confidence" };
  }

  const targetStatus = targetStatusFor(result.accountingConfidence.accountingConfidenceLevel);
  try {
    await applyAiClassification(
      companyId,
      transaction.id,
      { suggestedGlAccount: result.accountCode, confidence: result.confidence, explanation: explanationFor(result), modelUsed: result.modelUsed, targetStatus },
      performedBy,
    );
  } catch (error) {
    // The provider answered (a real request); the write lost a race or failed.
    return { ...answered, status: "failed", outcome: "write_error", providerMessage: sanitizeProviderMessage(errorMessageOf(error), sensitive) };
  }
  // Customer-facing `ai_requests` metering is unchanged by the safety work
  // (a separate policy decision); the internal provider-request count is
  // recorded with the attempt instead.
  await recordUsageEvent(companyId, "ai_requests").catch(() => {});
  return { ...answered, status: targetStatus === "Allocated" ? "allocated" : "classified", outcome: targetStatus === "Allocated" ? "allocated" : "suggested" };
}

export type ClassificationRunOptions = {
  /** Which path is asking — recorded with every attempt. Default "import". */
  source?: AttemptSource;
  /** The scheduler run this attempt belongs to, when there is one. */
  taskRunId?: number | null;
  /** Injectable clock (tests, and one timestamp per scheduler pass). */
  nowIso?: string;
};

/** Why a batch stopped before trying every candidate, if it did. */
export type ClassificationStopReason = "circuit_open" | "daily_cap" | "provider_failure" | "rate_limited" | "safety_unavailable" | "recording_failed";

type BatchRun = {
  attempts: { transaction: BankTransactionRecord; result: AttemptResult }[];
  /** Transactions the gate held back (cooldown, human review, resolved) — never sent. */
  heldIds: number[];
  stoppedReason: ClassificationStopReason | null;
  initialRequestsToday: number | null;
  dailyCap: number;
  circuitState: "open" | "closed" | null;
  infrastructureMessage: string | null;
};

/** The shared loop: gate → one request → record, stopping at the first
 * provider-level failure, rate limit, open circuit, daily cap, or any
 * failure of the safety store itself. The ONLY place a classification
 * provider is called. */
async function runClassificationBatch(
  companyId: string,
  transactions: BankTransactionRecord[],
  provider: TransactionClassificationProvider,
  performedBy: string,
  options: ClassificationRunOptions,
): Promise<BatchRun> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const source = options.source ?? "import";
  const batch: BatchRun = { attempts: [], heldIds: [], stoppedReason: null, initialRequestsToday: null, dailyCap: AI_PROVIDER_DAILY_REQUEST_CAP, circuitState: null, infrastructureMessage: null };

  for (const transaction of transactions) {
    let gate;
    try {
      gate = await gateAiProviderRequest(companyId, transaction.id, source, nowIso);
    } catch (error) {
      batch.stoppedReason = "safety_unavailable";
      batch.infrastructureMessage = sanitizeProviderMessage(errorMessageOf(error));
      break;
    }
    batch.dailyCap = gate.dailyCap;
    if (gate.decision === "held") {
      batch.heldIds.push(transaction.id);
      continue;
    }
    if (gate.circuitState) batch.circuitState = gate.circuitState;
    if (batch.initialRequestsToday === null && gate.requestsToday !== null) batch.initialRequestsToday = gate.requestsToday;
    if (gate.decision === "circuit_open") {
      batch.stoppedReason = "circuit_open";
      break;
    }
    if (gate.decision === "daily_cap") {
      batch.stoppedReason = "daily_cap";
      break;
    }
    // Fail closed: only an explicit allow or probe ever reaches the provider.
    if (gate.decision !== "allow" && gate.decision !== "probe") {
      batch.stoppedReason = "safety_unavailable";
      batch.infrastructureMessage = "The AI classification gate returned an unexpected decision.";
      break;
    }

    const started = performance.now();
    const result = await classifyOne(companyId, transaction, provider, performedBy);
    const durationMs = performance.now() - started;
    batch.attempts.push({ transaction, result });

    try {
      const recorded = await recordAiClassificationAttempt({
        companyId,
        transactionId: transaction.id,
        taskRunId: options.taskRunId ?? null,
        source,
        outcome: result.outcome,
        providerRequestMade: result.providerRequestMade,
        model: result.model,
        errorCategory: result.errorCategory,
        httpStatus: result.httpStatus,
        providerMessage: result.providerMessage,
        usage: result.usage,
        durationMs,
        performedBy,
        circuitSignal: result.circuitSignal,
        nowIso,
        probe: gate.decision === "probe",
      });
      batch.circuitState = recorded.circuitState;
    } catch (error) {
      // Without a recorded attempt the queue can't move on — never keep sending.
      batch.stoppedReason = "recording_failed";
      batch.infrastructureMessage = sanitizeProviderMessage(errorMessageOf(error));
      break;
    }

    if (result.status === "rate-limited") {
      batch.stoppedReason = "rate_limited";
      break;
    }
    if (result.providerLevelFailure) {
      batch.stoppedReason = "provider_failure";
      break;
    }
  }

  return batch;
}

export type ClassifyTransactionsOutcome = {
  attempted: number;
  /** Written `allocation_status: 'Suggested'`. */
  classified: number;
  /** Written `allocation_status: 'Allocated'` (currently paused, Phase 28). */
  autoAllocated: number;
  /** The model answered but nothing confident enough to write. */
  noConfidentSuggestion: number;
  /** Every other non-success: invalid answers, provider failures, database failures. */
  failed: number;
  /** The provider rate-limited us; the batch stopped. */
  rateLimited: number;
  /** The provider's own Retry-After, when it gave one — bounded to 15 s–5 min. */
  retryAfterMs?: number;
  /** Requests that actually reached the provider (the internal metric). */
  providerRequests: number;
  invalidResponses: number;
  providerFailures: number;
  /** Evidence reads or suggestion writes that failed. */
  databaseFailures: number;
  /** Transactions the gate held back (cooldown, human review, resolved); never sent. */
  heldByQueue: number;
  stoppedReason: ClassificationStopReason | null;
  /** The most recent failure's details, sanitized. */
  errorCategory: ProviderErrorCategory | null;
  httpStatus: number | null;
  providerMessage: string | null;
  circuitState: "open" | "closed" | null;
  /** This company's provider requests so far today (UTC), including this batch. */
  requestsToday: number | null;
  dailyCap: number;
  /** The safety store could not be used, or every attempt failed on the database. */
  infrastructureFailure: boolean;
};

function emptyOutcome(): ClassifyTransactionsOutcome {
  return {
    attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0,
    providerRequests: 0, invalidResponses: 0, providerFailures: 0, databaseFailures: 0, heldByQueue: 0,
    stoppedReason: null, errorCategory: null, httpStatus: null, providerMessage: null,
    circuitState: null, requestsToday: null, dailyCap: AI_PROVIDER_DAILY_REQUEST_CAP, infrastructureFailure: false,
  };
}

function summarize(batch: BatchRun): ClassifyTransactionsOutcome {
  const outcome = emptyOutcome();
  outcome.stoppedReason = batch.stoppedReason;
  outcome.circuitState = batch.circuitState;
  outcome.dailyCap = batch.dailyCap;
  outcome.heldByQueue = batch.heldIds.length;
  let lastFailure: AttemptResult | null = null;

  for (const { result } of batch.attempts) {
    outcome.attempted += 1;
    if (result.providerRequestMade) outcome.providerRequests += 1;
    if (result.status === "classified") outcome.classified += 1;
    else if (result.status === "allocated") outcome.autoAllocated += 1;
    else if (result.status === "no-confident-suggestion") outcome.noConfidentSuggestion += 1;
    else if (result.status === "rate-limited") {
      outcome.rateLimited += 1;
      if (result.retryAfterMs !== null) outcome.retryAfterMs = result.retryAfterMs;
      lastFailure = result;
    } else {
      outcome.failed += 1;
      if (result.outcome === "invalid_response") outcome.invalidResponses += 1;
      else if (result.outcome === "evidence_error" || result.outcome === "write_error") outcome.databaseFailures += 1;
      else outcome.providerFailures += 1;
      lastFailure = result;
    }
  }

  if (lastFailure) {
    outcome.errorCategory = lastFailure.errorCategory;
    outcome.httpStatus = lastFailure.httpStatus;
    outcome.providerMessage = lastFailure.providerMessage;
  }
  if (batch.infrastructureMessage) outcome.providerMessage = batch.infrastructureMessage;
  outcome.requestsToday = batch.initialRequestsToday === null ? null : batch.initialRequestsToday + outcome.providerRequests;
  outcome.infrastructureFailure =
    batch.stoppedReason === "safety_unavailable" ||
    batch.stoppedReason === "recording_failed" ||
    (outcome.attempted > 0 && outcome.databaseFailures === outcome.attempted);
  return outcome;
}

/** Automatic classification of a given set of transactions — after an
 * import/bank sync (source "import") and the core of the sweep. Never
 * throws; the outcome says what happened and why it stopped. */
export async function classifyUnallocatedTransactionsWithAi(
  companyId: string,
  transactionIds: number[],
  performedBy = "VYRON AI",
  options: ClassificationRunOptions = {},
): Promise<ClassifyTransactionsOutcome> {
  if (transactionIds.length === 0) return emptyOutcome();

  let transactions: BankTransactionRecord[];
  try {
    transactions = await getTransactionsByIds(companyId, transactionIds);
  } catch {
    return emptyOutcome();
  }

  // Keep the caller's order — for the sweep that is the queue's priority order.
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const ordered = transactionIds.map((id) => byId.get(id)).filter((t): t is BankTransactionRecord => t !== undefined);
  const eligible = ordered.filter(isEligibleForAiClassification).slice(0, MAX_AI_CLASSIFICATIONS_PER_RUN);
  if (eligible.length === 0) return emptyOutcome();

  const provider = await getDefaultTransactionClassificationProvider().catch(() => null);
  if (!provider) return emptyOutcome();

  const batch = await runClassificationBatch(companyId, eligible, provider, performedBy, options);
  return summarize(batch);
}

/** Migration 0094 — a held transaction gets its OWN reason rather than
 * the generic ineligibility one. */
export const HELD_FOR_REVIEW_SKIP_REASON =
  "Held for human review — automatic classification is not allowed while a person is reviewing this transaction." as const;

export type ManualClassifySkipReason =
  | "Not eligible for AI classification — already classified, allocated, or matched."
  | typeof HELD_FOR_REVIEW_SKIP_REASON
  | "Skipped — the AI classification batch/usage limit was reached for this request."
  | "AI could not confidently classify this transaction."
  | "AI classification failed for this transaction — please try again."
  | "AI classification is temporarily unavailable."
  | "Skipped — the AI provider's rate limit was reached for this request. Please try again shortly.";

export type ManualClassifyOutcome = {
  requested: number;
  classified: number;
  autoAllocated: number;
  rateLimited: number;
  /** `{ transactionId, reason }` — the shape the Explorer's bulk-action notice already renders. */
  skipped: { transactionId: number; reason: ManualClassifySkipReason }[];
};

/** Phase 22B — the user-triggered "Classify with AI" (single or bulk).
 * Explicit, so it ignores the sweep's cooldown/human-review selection —
 * this is also the "Retry AI" path — but it goes through the same gate
 * (circuit breaker and daily fuse), recording and stop rules as every
 * automatic path. `maxCount` lets the route apply a smaller cap when the
 * plan's remaining AI allowance is the tighter constraint. */
export async function classifyTransactionsWithAiManual(
  companyId: string,
  transactionIds: number[],
  performedBy: string,
  maxCount: number = MAX_AI_CLASSIFICATIONS_PER_RUN,
  options: { nowIso?: string } = {},
): Promise<ManualClassifyOutcome> {
  const skipped: ManualClassifyOutcome["skipped"] = [];
  if (transactionIds.length === 0) return { requested: 0, classified: 0, autoAllocated: 0, rateLimited: 0, skipped };

  let transactions: BankTransactionRecord[];
  try {
    transactions = await getTransactionsByIds(companyId, transactionIds);
  } catch {
    return { requested: transactionIds.length, classified: 0, autoAllocated: 0, rateLimited: 0, skipped: transactionIds.map((transactionId) => ({ transactionId, reason: "AI classification is temporarily unavailable." })) };
  }

  const eligible: BankTransactionRecord[] = [];
  for (const t of transactions) {
    if (isEligibleForAiClassification(t)) eligible.push(t);
    else if (isHeldForHumanReview(t)) skipped.push({ transactionId: t.id, reason: HELD_FOR_REVIEW_SKIP_REASON });
    else skipped.push({ transactionId: t.id, reason: "Not eligible for AI classification — already classified, allocated, or matched." });
  }

  const toProcess = eligible.slice(0, Math.max(0, maxCount));
  for (const t of eligible.slice(Math.max(0, maxCount))) {
    skipped.push({ transactionId: t.id, reason: "Skipped — the AI classification batch/usage limit was reached for this request." });
  }

  if (toProcess.length === 0) return { requested: transactionIds.length, classified: 0, autoAllocated: 0, rateLimited: 0, skipped };

  const provider = await getDefaultTransactionClassificationProvider().catch(() => null);
  if (!provider) {
    for (const t of toProcess) skipped.push({ transactionId: t.id, reason: "AI classification is temporarily unavailable." });
    return { requested: transactionIds.length, classified: 0, autoAllocated: 0, rateLimited: 0, skipped };
  }

  const batch = await runClassificationBatch(companyId, toProcess, provider, performedBy, { source: "manual", nowIso: options.nowIso });

  let classified = 0;
  let autoAllocated = 0;
  let rateLimited = 0;
  const handled = new Set<number>();
  for (const { transaction, result } of batch.attempts) {
    handled.add(transaction.id);
    if (result.status === "classified") classified += 1;
    else if (result.status === "allocated") autoAllocated += 1;
    else if (result.status === "no-confident-suggestion") skipped.push({ transactionId: transaction.id, reason: "AI could not confidently classify this transaction." });
    else if (result.status === "rate-limited") {
      skipped.push({ transactionId: transaction.id, reason: "Skipped — the AI provider's rate limit was reached for this request. Please try again shortly." });
      rateLimited += 1;
    } else skipped.push({ transactionId: transaction.id, reason: "AI classification failed for this transaction — please try again." });
  }

  // Everything the batch never sent: held by the gate, or not reached because it stopped.
  for (const t of toProcess) {
    if (handled.has(t.id)) continue;
    if (batch.stoppedReason === "rate_limited" && !batch.heldIds.includes(t.id)) {
      skipped.push({ transactionId: t.id, reason: "Skipped — the AI provider's rate limit was reached for this request. Please try again shortly." });
      rateLimited += 1;
    } else {
      skipped.push({ transactionId: t.id, reason: "AI classification is temporarily unavailable." });
    }
  }

  return { requested: transactionIds.length, classified, autoAllocated, rateLimited, skipped };
}

export type AutomaticClassificationSweepOutcome = ClassifyTransactionsOutcome & {
  /** More transactions are currently eligible beyond this batch. */
  hasMoreEligible: boolean;
  /** At least one suggestion/allocation was saved — the only thing that
   * justifies the scheduler coming back in 2 minutes. */
  progress: boolean;
  /** How many candidates the queue offered this pass. */
  candidates: number;
};

/** The scheduler's `AiClassificationSweep`: takes the next batch from the
 * queue (never-attempted first, then least recently attempted, then
 * oldest; cooldown, needs-human-review and resolved excluded) and
 * classifies it. A failure to read the queue is an infrastructure failure
 * and THROWS, so the scheduler's retry/suspension handling applies. */
export async function runAutomaticAiClassificationSweep(
  companyId: string,
  performedBy = "VYRON AI",
  options: { taskRunId?: number | null; nowIso?: string } = {},
): Promise<AutomaticClassificationSweepOutcome> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const { transactionIds, hasMore } = await listAiClassificationSweepCandidates(companyId, MAX_AI_CLASSIFICATIONS_PER_RUN, nowIso);
  if (transactionIds.length === 0) {
    return { ...emptyOutcome(), hasMoreEligible: false, progress: false, candidates: 0 };
  }

  const outcome = await classifyUnallocatedTransactionsWithAi(companyId, transactionIds, performedBy, { source: "sweep", taskRunId: options.taskRunId ?? null, nowIso });
  return { ...outcome, hasMoreEligible: hasMore, progress: outcome.classified + outcome.autoAllocated > 0, candidates: transactionIds.length };
}
