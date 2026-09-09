/**
 * Phase 22A — AI Transaction Classification orchestrator. The ONE place
 * that decides WHICH transactions are eligible for an AI suggestion,
 * calls the classification model for each, and writes the result via
 * the existing allocation-history-backed repository path
 * (`applyAiClassification`). Never creates a journal, never touches
 * Banking Rules, Banking Exceptions, or the Posting Engine — every
 * suggestion/allocation this writes is read by all of those exactly the
 * way a Banking Rule's own GL-only match already is.
 *
 * PRECEDENCE MODEL (Phase 22A's own resolution of this ticket's section
 * 11): AI classification runs ONLY on a transaction the Rule Engine and
 * Matching Engine left completely untouched — see
 * `isEligibleForAiClassification` in `@/server/ai/transaction-classification/types`,
 * now the ONE shared eligibility check every caller uses (Phase 22B
 * extracted it there specifically so the client-side Transaction
 * Explorer UI and this server-side service never risk drifting apart).
 *
 * Phase 22B adds a second, explicitly user-triggered entry point —
 * `classifyTransactionsWithAiManual` — alongside the original automatic
 * one (`classifyUnallocatedTransactionsWithAi`, UNCHANGED behavior/
 * signature). Both share the same one-transaction-at-a-time core
 * (`classifyOne` below) rather than duplicating the classify/validate/
 * persist sequence twice. Billing feature/usage gating (hasFeature/
 * checkUsageLimit) is deliberately NOT done in this file — exactly like
 * `askCopilot` doesn't gate itself either — it happens at the route layer
 * (`transactions/bulk/route.ts`), keeping this service usable from any
 * caller without assuming a particular billing-gating point.
 *
 * Phase 26A — AUTOMATIC ALLOCATION (Option 3, investigated and
 * implemented per that ticket's own Parts D/E). Before this phase, EVERY
 * successful classification — regardless of confidence — wrote
 * `allocation_status: 'Suggested'`; confidence was stored but never
 * acted on. Now `targetStatusFor()` below decides `'Allocated'` for a
 * genuinely High-confidence result (>=85, VYRON's own deterministic
 * threshold from `confidenceLevelFor()`, never the model's own opinion)
 * and `'Suggested'` for everything else (Medium confidence, or a defensive
 * fallback) — Low confidence (`accountCode === null`) still writes
 * nothing, exactly as before. This is purely a WRITE-TARGET decision on
 * top of the existing, unchanged classify/validate pipeline — the
 * hallucination defense (`classification-engine.ts`), the company-scoped
 * candidate-account allow-list (`evidence-builder.ts`), and the atomic,
 * narrow-eligibility RPC write (`fn_apply_ai_classification`, migration
 * 0083) are ALL unchanged from Phase 22A/25K; only which literal status
 * that RPC is told to write is new. AI still never creates or posts a
 * journal, still never runs on a transaction Rules/Matching already
 * touched, and still never overrides a manual action — automatic
 * allocation is not automatic posting.
 *
 * Phase 26E — AUTOMATIC, UNATTENDED CLASSIFICATION. Before this phase,
 * every entry point here needed a caller-supplied `transactionIds` list —
 * fine for `import-service.ts`/`bank-sync-service.ts` (which always
 * already know exactly which rows they just created) and for the manual
 * "Classify with AI" UI action, but there was no path that could sweep
 * EXISTING/historical eligible transactions without a human selecting
 * them first. `runAutomaticAiClassificationSweep` below closes that gap —
 * it finds its own candidates (`listAiClassificationEligibleTransactions`,
 * a query-level restatement of the exact same `isEligibleForAiClassification`
 * check, never a second eligibility definition) and hands them to the
 * SAME `classifyUnallocatedTransactionsWithAi` every other automatic path
 * already uses. It is wired into the existing Automation Scheduler
 * (`scheduler-service.ts`, task type `AiClassificationSweep`) as a
 * standing, self-healing, bounded-batch task — the same architecture
 * `RuleEngineRun`'s recovery sweep already established, not a new
 * execution mechanism. This phase also added rate-limit-aware early
 * stopping to both existing loops below (`classifyUnallocatedTransactionsWithAi`/
 * `classifyTransactionsWithAiManual`): a provider rate-limit no longer
 * gets treated as an ordinary per-transaction failure that the loop
 * simply continues past (which would hammer an already-rate-limited
 * provider on every remaining transaction) — it now stops the current
 * batch immediately, leaving every untried transaction exactly as
 * eligible as before, for the next run to pick up.
 */

import { getTransactionsByIds, applyAiClassification, listAiClassificationEligibleTransactions } from "@/server/repositories/transaction-explorer-repository";
import { buildTransactionClassificationEvidence } from "@/server/ai/transaction-classification/evidence-builder";
import { classifyTransactionWithAi, getDefaultTransactionClassificationProvider } from "@/server/ai/transaction-classification/classification-engine";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import { isEligibleForAiClassification } from "@/server/ai/transaction-classification/types";
import { AIProviderError } from "@/server/ai/types";
import { isHeldForHumanReview, type BankTransactionRecord } from "@/server/accounting/types";
import type { TransactionClassificationProvider, TransactionClassificationResult } from "@/server/ai/transaction-classification/types";

/** Bounds cost/latency per run (this ticket's own section 13/16: "Do not
 * call the AI model unnecessarily" / "Do not permit uncontrolled AI
 * spending"). Phase 22B reuses this SAME cap for the manual action
 * rather than inventing a second number — there is no reason a
 * user-triggered batch should be allowed to be larger than the
 * already-established safe size, and one shared constant is one fewer
 * thing to keep in sync. Exported so the API route can compute the
 * combined batch/usage-limit cap without guessing this value. */
export const MAX_AI_CLASSIFICATIONS_PER_RUN = 20;

type ClassifyOneStatus = "classified" | "allocated" | "no-confident-suggestion" | "failed" | "rate-limited";

/** Phase 28, Part 1 — PRODUCTION SAFETY PAUSE, temporary and reversible.
 * The Phase 28 forensic investigation found the model's self-reported
 * `confidence` (what `targetStatusFor` below has always gated automatic
 * allocation on) measures the model's own certainty in its answer, NOT
 * VYRON's accounting confidence that the answer is correct — see the
 * full report for evidence (repeated over-selection of 6100 Bank
 * Charges at self-reported confidences of 85-95%). Automatically
 * writing `allocation_status: 'Allocated'` on that signal alone is, as
 * of this investigation, not yet trustworthy.
 *
 * Set this to `false` to restore the pre-Phase-28 behavior (High
 * confidence -> immediate `'Allocated'`) once a real accounting-evidence-
 * based decision framework (the Phase 28 report's Part 7/8 proposal)
 * replaces raw model confidence as the automation gate. This is the
 * ONLY change Part 1 makes: no existing data touched, no journal
 * created, Banking Rules and Matching completely untouched, and every
 * transaction the AI would have Allocated is instead written exactly as
 * `'Suggested'` already is today for Medium confidence — same write
 * path, same audit trail, just requiring the human Accept step this
 * investigation found necessary. */
const AUTO_ALLOCATE_HIGH_CONFIDENCE = false;

/** Phase 26A — Option 3 (investigated per this ticket's own Part D):
 * automatic allocation is permitted ONLY for a genuinely High-confidence
 * classification (VYRON's own deterministic `confidenceLevelFor()`
 * threshold, >=85 — never the model's own stated opinion of "high").
 * Medium and Low confidence are UNCHANGED from the original Phase 22A
 * behavior — Medium still writes `'Suggested'` for human review, Low
 * (`accountCode === null`) still writes nothing at all. This is the
 * ONLY place that decision is made; `applyAiClassification`'s repository
 * layer stays a pure write path with no confidence policy of its own
 * (mirrors this codebase's own "TypeScript decides business logic, the
 * RPC only performs the atomic write" separation, e.g. `runTask`'s task-
 * type dispatch deciding retry policy, never the DB layer). */
/** Phase 28 — now driven by `accountingConfidence.accountingConfidenceLevel`
 * (`accounting-confidence.ts`), NOT the model's own raw `confidenceLevel`.
 * The forensic report's central finding was exactly that these two are
 * not the same claim — see that module's own docstring. Signature
 * otherwise unchanged: still the ONE place this decision is made,
 * `applyAiClassification` remains a pure write path with no confidence
 * policy of its own. */
function targetStatusFor(accountingConfidenceLevel: TransactionClassificationResult["accountingConfidence"]["accountingConfidenceLevel"]): "Suggested" | "Allocated" {
  return accountingConfidenceLevel === "High" && AUTO_ALLOCATE_HIGH_CONFIDENCE ? "Allocated" : "Suggested";
}

/** Phase 28, Part 8 — "A correct Unallocated/Suggested transaction is
 * acceptable. A confidently wrong automatic allocation is not... If the
 * evidence is insufficient, [the system] must decline to allocate it."
 * Low accounting confidence — genuinely weak/no historical evidence, an
 * ambiguous candidate set, or (worse) a model answer that actively
 * CONTRADICTS this company's own strong confirmed history — is now
 * treated the same as "no confident suggestion": nothing is written,
 * the transaction is left genuinely Unallocated for a human to decide,
 * rather than cluttering the review queue with a low-quality guess. */
function isAccountingConfidenceSufficientToSuggest(accountingConfidenceLevel: TransactionClassificationResult["accountingConfidence"]["accountingConfidenceLevel"]): boolean {
  return accountingConfidenceLevel !== "Low";
}

/** Phase 28, Part 11 — "The AI explanation should eventually be able to
 * say things like: 'Similar FNB online-banking payments to named
 * individuals have historically been allocated to Salaries & Wages by
 * this company.' ... Add tests preventing the bad interpretation." The
 * PRIMARY stored explanation is always the accounting-evidence-based
 * one (`accountingConfidence.explanation`) — the model's own raw
 * narration-based reasoning (the exact class of text that caused the
 * Phase 28 production defect) is NEVER the primary explanation, and is
 * only ever appended, clearly labelled as unverified, when there's
 * genuinely no strong company evidence to lean on instead. */
function explanationFor(result: TransactionClassificationResult): string {
  const { accountingConfidence } = result;
  if (accountingConfidence.evidenceStrength === "None" || accountingConfidence.evidenceStrength === "Weak") {
    return `${accountingConfidence.explanation} The AI's own stated reasoning (not independently verified against this company's history): "${result.explanation}"`;
  }
  return accountingConfidence.explanation;
}

/** Phase 26I — `classifyOne`'s result plus, on a rate-limit, whatever
 * real cooldown the provider itself stated (see `extractRetryAfterMs` in
 * `gateway-provider.ts`). Carried up to `ClassifyTransactionsOutcome` so
 * the Scheduler can reschedule the NEXT sweep precisely instead of
 * guessing — see `scheduler-service.ts::nextTaskRunAt`. `null` (not the
 * absence of the field) when rate-limited but no header was present, so
 * callers can distinguish "provider gave no guidance, use our own
 * conservative default" from "not rate-limited at all." */
type ClassifyOneOutcome = { status: ClassifyOneStatus; retryAfterMs: number | null };

/** The single-transaction core both entry points below share — classify,
 * validate (via `classifyTransactionWithAi`'s own hallucination defense),
 * persist on a real suggestion or automatic allocation, record usage
 * ONLY on that same success path (this ticket's section 7 decision — see
 * the completion report), and never throw: every failure mode collapses
 * to `"failed"`, leaving the transaction exactly as it was. */
async function classifyOne(companyId: string, transaction: BankTransactionRecord, provider: TransactionClassificationProvider, performedBy: string): Promise<ClassifyOneOutcome> {
  try {
    const evidence = await buildTransactionClassificationEvidence(companyId, transaction);
    const result = await classifyTransactionWithAi(provider, evidence);

    if (result.accountCode === null) return { status: "no-confident-suggestion", retryAfterMs: null };

    // Phase 28, Part 8 — accounting confidence, not the model's own raw
    // confidence, decides whether this is even worth surfacing at all.
    if (!isAccountingConfidenceSufficientToSuggest(result.accountingConfidence.accountingConfidenceLevel)) {
      return { status: "no-confident-suggestion", retryAfterMs: null };
    }

    const targetStatus = targetStatusFor(result.accountingConfidence.accountingConfidenceLevel);
    await applyAiClassification(
      companyId,
      transaction.id,
      { suggestedGlAccount: result.accountCode, confidence: result.confidence, explanation: explanationFor(result), modelUsed: result.modelUsed, targetStatus },
      performedBy,
    );
    // Recorded ONLY on a real, persisted suggestion/allocation — matching
    // the exact convention `copilot/ask/route.ts` already established
    // (usage is recorded after `askCopilot` succeeds, never before,
    // never on failure). A "no confident suggestion" or a failed
    // provider call never consumed anything real, so it never consumes
    // usage either.
    await recordUsageEvent(companyId, "ai_requests").catch(() => {});
    return { status: targetStatus === "Allocated" ? "allocated" : "classified", retryAfterMs: null };
  } catch (error) {
    // Phase 26E — a provider rate-limit is not an ordinary per-transaction
    // failure: it means every SUBSEQUENT call in this same batch is
    // likely to fail the exact same way, so the caller needs to know to
    // stop attempting more rather than treat this like any other single
    // bad transaction and continue hammering the provider.
    if (error instanceof AIProviderError && error.code === "rate-limit") return { status: "rate-limited", retryAfterMs: error.retryAfterMs };
    return { status: "failed", retryAfterMs: null };
  }
}

export type ClassifyTransactionsOutcome = {
  attempted: number;
  /** Written `allocation_status: 'Suggested'` — Medium confidence, or
   * `confidenceLevel` unavailable (defensive). Unchanged meaning from
   * before Phase 26A — a High-confidence result is counted in
   * `autoAllocated` below instead, never double-counted here. */
  classified: number;
  /** Phase 26A — written `allocation_status: 'Allocated'` directly (High
   * confidence, >=85, VYRON's own deterministic threshold). A real
   * automatic allocation, not a suggestion — see `targetStatusFor`. */
  autoAllocated: number;
  /** A transaction the model honestly couldn't confidently classify
   * (`accountCode: null`) — left `Unallocated`, not an error. */
  noConfidentSuggestion: number;
  /** A transaction skipped because a provider/network call failed —
   * left `Unallocated`. */
  failed: number;
  /** Phase 26E — the provider returned a rate-limit error. Counted
   * separately from `failed` so a caller can tell "the AI is broken" (many
   * `failed`) apart from "we're going too fast" (any `rateLimited` at
   * all) — the latter is an expected, transient condition the next
   * scheduled run resolves on its own, never grounds for an alert. Once
   * this hits >0 in a given call, the loop below stops attempting further
   * transactions in THIS batch — every transaction after the rate-limited
   * one was never attempted at all, and remains exactly as eligible as
   * before. */
  rateLimited: number;
  /** Phase 26I — the real, provider-stated cooldown (from a `Retry-After`
   * response header), in milliseconds, when `rateLimited > 0` AND the
   * provider actually supplied one. Absent (not merely `null`) whenever
   * there's no real number to report — a batch that never rate-limited,
   * or one that did but got no such header from the provider —
   * specifically so this never breaks a pre-existing exact
   * `toEqual({...})` assertion elsewhere in this codebase. Never present
   * at all on `classifyTransactionsWithAiManual`'s `ManualClassifyOutcome`,
   * which doesn't reschedule anything and has no use for it. */
  retryAfterMs?: number;
};

/** Phase 22A's original entry point — called once, synchronously,
 * immediately after Banking Rules finish running on a freshly imported
 * batch (`import-service.ts`). UNCHANGED behavior and signature (this
 * ticket's section 15: "Do not remove or change Phase 22A's automatic
 * classification"). Never throws. Deliberately NOT gated by
 * hasFeature/checkUsageLimit — it already existed, ungated, before this
 * phase, and gating a background step of an already-successful import
 * would itself be the kind of change section 15 forbids. It still
 * contributes to the same `ai_requests` usage metric the new manual
 * path's usage check reads, so a company that exhausts its allowance via
 * automatic imports alone is correctly reflected there. */
export async function classifyUnallocatedTransactionsWithAi(companyId: string, transactionIds: number[], performedBy = "VYRON AI"): Promise<ClassifyTransactionsOutcome> {
  const outcome: ClassifyTransactionsOutcome = { attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0 };
  if (transactionIds.length === 0) return outcome;

  let transactions: BankTransactionRecord[];
  try {
    transactions = await getTransactionsByIds(companyId, transactionIds);
  } catch {
    return outcome;
  }

  const eligible = transactions.filter(isEligibleForAiClassification).slice(0, MAX_AI_CLASSIFICATIONS_PER_RUN);
  if (eligible.length === 0) return outcome;

  const provider = await getDefaultTransactionClassificationProvider().catch(() => null);
  if (!provider) return outcome;

  for (const transaction of eligible) {
    outcome.attempted += 1;
    const { status, retryAfterMs } = await classifyOne(companyId, transaction, provider, performedBy);
    if (status === "classified") outcome.classified += 1;
    else if (status === "allocated") outcome.autoAllocated += 1;
    else if (status === "no-confident-suggestion") outcome.noConfidentSuggestion += 1;
    else if (status === "rate-limited") {
      outcome.rateLimited += 1;
      // Only set when the provider actually gave a real number — an
      // absent key (rather than an explicit `null`) keeps every
      // pre-Phase-26I `toEqual({...})` assertion elsewhere in this
      // codebase compiling and passing unchanged; `nextTaskRunAt`'s own
      // `typeof summary?.retryAfterMs === "number"` check already
      // treats "absent" and "explicitly null" identically anyway.
      if (retryAfterMs !== null) outcome.retryAfterMs = retryAfterMs;
      // Phase 26E — stop this batch immediately; every remaining
      // transaction in `eligible` is left exactly as untouched/eligible
      // as it was before this call, for the next run to pick up.
      break;
    } else outcome.failed += 1;
  }

  return outcome;
}

/** Migration 0094 — a held transaction gets its OWN reason rather than
 * the generic ineligibility one. "Already classified, allocated, or
 * matched" would be a false explanation for a row that is none of those
 * things and is simply being reviewed by a person, and the accountant
 * reading it needs to know the difference: one means the work is done,
 * the other means someone is doing it. */
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
  /** Written `allocation_status: 'Suggested'` — unchanged meaning from
   * before Phase 26A. See `ClassifyTransactionsOutcome.classified`. */
  classified: number;
  /** Phase 26A — written `allocation_status: 'Allocated'` directly
   * (High confidence). See `ClassifyTransactionsOutcome.autoAllocated`. */
  autoAllocated: number;
  /** Phase 26E — see `ClassifyTransactionsOutcome.rateLimited`. Also
   * reflected as one `skipped` entry per affected transaction, for the
   * existing UI rendering path — this count is purely a convenience for
   * callers that want the number without counting `skipped` reasons. */
  rateLimited: number;
  /** Mirrors the SAME `{ transactionId, reason }` shape
   * `transaction-explorer.tsx::runBulkAction` already knows how to
   * render as a notice for other bulk actions (e.g. `generate-journal`'s
   * skip reasons) — reused as-is, no new client-side rendering needed. */
  skipped: { transactionId: number; reason: ManualClassifySkipReason }[];
};

/** Phase 22B — the user-triggered "Classify with AI" entry point, for
 * both the single-transaction (detail panel) and bulk (selection +
 * bulk-action-bar) UI paths — both call this exact same function via the
 * SAME `POST /transactions/bulk` `"classify-with-ai"` case, exactly
 * mirroring how `allocate-row` already unifies single/bulk with one code
 * path. `maxCount` lets the route pass a SMALLER effective cap than
 * `MAX_AI_CLASSIFICATIONS_PER_RUN` when the company's remaining AI usage
 * allowance is the tighter constraint (this ticket's section 6D) — the
 * route, not this function, owns that billing arithmetic. */
export async function classifyTransactionsWithAiManual(
  companyId: string,
  transactionIds: number[],
  performedBy: string,
  maxCount: number = MAX_AI_CLASSIFICATIONS_PER_RUN,
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

  let classified = 0;
  let autoAllocated = 0;
  let rateLimited = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const t = toProcess[i]!;
    const { status } = await classifyOne(companyId, t, provider, performedBy);
    if (status === "classified") classified += 1;
    else if (status === "allocated") autoAllocated += 1;
    else if (status === "no-confident-suggestion") skipped.push({ transactionId: t.id, reason: "AI could not confidently classify this transaction." });
    else if (status === "rate-limited") {
      // Phase 26E — this transaction, and everything still unprocessed in
      // this same request, are left exactly as eligible as before; none
      // of them were actually attempted after the rate limit hit.
      for (const remaining of toProcess.slice(i)) {
        skipped.push({ transactionId: remaining.id, reason: "Skipped — the AI provider's rate limit was reached for this request. Please try again shortly." });
        rateLimited += 1;
      }
      break;
    } else skipped.push({ transactionId: t.id, reason: "AI classification failed for this transaction — please try again." });
  }

  return { requested: transactionIds.length, classified, autoAllocated, rateLimited, skipped };
}

export type AutomaticClassificationSweepOutcome = ClassifyTransactionsOutcome & {
  /** Phase 26E — true when `listAiClassificationEligibleTransactions`
   * returned exactly `MAX_AI_CLASSIFICATIONS_PER_RUN` rows, meaning more
   * eligible transactions may still exist beyond this one batch. A
   * conservative heuristic the scheduler uses only to decide whether to
   * reschedule itself soon (more likely work waiting) or fall back to its
   * normal cadence (caught up) — never to skip or defer real work; the
   * batch itself already ran regardless of this flag. */
  hasMoreEligible: boolean;
};

/** Phase 26E — the automatic, unattended entry point: finds its own
 * candidates company-wide (unlike the two entry points above, which both
 * require a caller-supplied id list) and classifies up to one bounded
 * batch of them through the exact same `classifyUnallocatedTransactionsWithAi`
 * every other automatic path already uses — no second classification
 * engine, no second write path, no second eligibility definition. Called
 * by the Automation Scheduler's `AiClassificationSweep` task
 * (`scheduler-service.ts`), never directly by a route — a scheduled task
 * is the one thing in this codebase that legitimately has no caller-
 * supplied transaction list to work from. Never throws — a candidate
 * fetch failure is treated exactly like `classifyUnallocatedTransactionsWithAi`
 * already treats a `getTransactionsByIds` failure elsewhere in this file:
 * an empty, harmless outcome, not a hard error. */
export async function runAutomaticAiClassificationSweep(companyId: string, performedBy = "VYRON AI"): Promise<AutomaticClassificationSweepOutcome> {
  const candidates = await listAiClassificationEligibleTransactions(companyId, MAX_AI_CLASSIFICATIONS_PER_RUN).catch(() => []);
  if (candidates.length === 0) {
    return { attempted: 0, classified: 0, autoAllocated: 0, noConfidentSuggestion: 0, failed: 0, rateLimited: 0, hasMoreEligible: false };
  }

  const outcome = await classifyUnallocatedTransactionsWithAi(companyId, candidates.map((t) => t.id), performedBy);
  return { ...outcome, hasMoreEligible: candidates.length === MAX_AI_CLASSIFICATIONS_PER_RUN };
}
