/**
 * Phase 22A — AI Transaction Classification. Domain types, analogous to
 * `src/server/ai/types.ts` (VYRON AI / Copilot) but for a structurally
 * different capability: not a conversational Q&A answer, but a single
 * suggested GL account for one bank transaction. Deliberately NOT built
 * on `EvidencePackage`/`VyronAiStructuredResponse` — those are typed
 * specifically to the Finding/BusinessSituation domain (see
 * `src/server/ai/types.ts`'s own docstring) and would not honestly fit a
 * transaction-classification shape without being widened into something
 * that fits neither use well.
 *
 * The Gateway mechanism itself (model resolution via `VYRON_AI_MODEL`,
 * `generateObject`, timeout, error classification) IS reused —
 * `gateway-classification-provider.ts` imports `DEFAULT_MODEL`/
 * `REQUEST_TIMEOUT_MS`/`classifyProviderError` from the existing
 * `../providers/gateway-provider.ts` rather than restating them.
 *
 * Same architectural rule as VYRON AI (brief-equivalent, this ticket's
 * own "IMPORTANT ARCHITECTURE RULE"): the AI is never the source of
 * accounting truth. It only SUGGESTS a `suggestedGlAccount` — exactly
 * the same field, and exactly the same "Suggested" `allocationStatus",
 * a Banking Rule's GL-only match already produces. Posting remains
 * entirely the existing Posting Engine's job; nothing in this module
 * creates or touches a journal.
 */

import type { AccountType } from "@/server/general-ledger/types";
import { isHeldForHumanReview, type BankTransactionRecord } from "@/server/accounting/types";
import type { AccountingConfidenceAssessment } from "./accounting-confidence";
import type { ProviderUsage } from "./safety-policy";

/** Phase 22B — the ONE eligibility check, shared by every caller:
 * `transaction-classification-service.ts` (both the automatic post-import
 * path and the new manual "Classify with AI" path) AND the client-side
 * Transaction Explorer UI (to decide whether to show/enable the action at
 * all). Deliberately a pure, type-only-import function with no server-only
 * dependency, so a "use client" component can import it directly without
 * pulling any repository/AI-provider code into the browser bundle.
 *
 * A transaction is eligible only when Banking Rules AND the Matching
 * Engine left it completely untouched — this is also, by construction,
 * why an already AI-classified transaction (which sets `suggestedGlAccount`)
 * or a user-overridden one (same field) is never reprocessed: both fail
 * this same check, with no separate "already AI classified" flag needed.
 *
 * Phase 26E — added the explicit `!t.isManualOverride` check. Migration
 * 0083's RPC-level WHERE clause already added this same tightening (a
 * defense-in-depth close of a real, if narrow, gap: a transaction can
 * reach `is_manual_override = true` — e.g. via the plain "Assign GL" bulk
 * action, `bulkAssignGl` — while every other field here still reads as
 * untouched, since that action deliberately never changes
 * `allocationStatus`/`suggestedGlAccount`'s presence the way the check
 * above alone would catch). This TypeScript check was the one place that
 * tightening was never mirrored, meaning a company-wide automatic sweep
 * (which selects candidates from this check, not a caller-supplied id
 * list) would waste a real AI provider call on such a transaction before
 * the RPC correctly rejected the write. Adding it here only ever narrows
 * eligibility — a transaction newly excluded by this line was already
 * guaranteed to fail the RPC's own write-time claim, so no previously
 * successful classification becomes impossible. */
export function isEligibleForAiClassification(t: BankTransactionRecord): boolean {
  return (
    t.journalId === null &&
    t.allocationStatus === "Unallocated" &&
    !t.suggestedGlAccount &&
    t.ruleId === null &&
    t.matchedSupplierId === null &&
    t.matchedCustomerId === null &&
    t.matchedMerchantId === null &&
    !t.isManualOverride &&
    // Migration 0094 — a transaction a person is holding for review is
    // never an AI candidate. This mirrors the guard in
    // `fn_apply_ai_classification`'s own WHERE clause, which is the
    // authoritative one; repeating it here stops the sweep spending a
    // real provider call on a row the database will refuse to write,
    // and stops the Explorer offering "Classify with AI" for it.
    !isHeldForHumanReview(t)
  );
}

/** One account VYRON is willing to let the AI choose from — always a
 * real, active Chart of Accounts row, pre-filtered by direction (see
 * `evidence-builder.ts`) to bound both prompt size and the chance of an
 * irrelevant suggestion. Never the full account, which would leak
 * fields (branch/department/cost-centre ids, control-account flags,
 * etc.) the model has no legitimate use for. */
export type ClassificationCandidateAccount = {
  accountCode: string;
  description: string;
  accountType: AccountType;
};

/** A prior, already-resolved transaction for the SAME beneficiary
 * string within THIS company — the only form of "history" this feature
 * uses. Never another company's data (the query that produces this is
 * itself `company_id`-scoped — see `evidence-builder.ts`), and never
 * more than the few fields actually useful as classification context. */
export type SimilarPastClassification = {
  description: string;
  glAccount: string;
  /** True when a human confirmed/overrode this classification (i.e. the
   * transaction's `isManualOverride` was true) — a stronger signal than
   * an unreviewed rule/AI suggestion, surfaced to the model as such. */
  wasManuallyConfirmed: boolean;
};

/** The ONLY input ever sent to the classification model — a strict
 * allow-list, mirroring `EvidencePackage`'s own discipline. No
 * supplier/customer PII beyond what the transaction record itself
 * already carries (beneficiary/description/reference — the same text a
 * human accountant would read off the bank statement), no other
 * company's data, no raw database ids beyond this transaction's own. */
/** Phase 28 — one company-scoped, aggregated evidence group for this
 * transaction's narration pattern (`narration-pattern.ts`), included
 * directly in what the AI sees (`gateway-classification-provider.ts`)
 * so the model itself can weigh real company history, not just guess
 * from the narration string. Structurally similar to
 * `CompanyHistoricalPatternEvidence` (`company-historical-evidence.ts`)
 * but a strict allow-list subset — the model never needs to see
 * `pattern.direction`/`isAmbiguous` internals, only the account
 * breakdown and how reliable it is. */
export type CompanyHistoricalPatternForAi = {
  /** e.g. "FNB OB Pmt" — a grouping label only, see narration-pattern.ts's
   * own docstring for why this is never itself evidence of anything. */
  narrationPrefix: string;
  amountRange: string;
  direction: "Debit" | "Credit";
  accounts: { accountCode: string; humanConfirmedCount: number; aiOnlyCount: number }[];
};

export type TransactionClassificationEvidence = {
  companyId: string;
  transactionId: number;
  description: string;
  beneficiary: string;
  reference: string;
  amount: number;
  direction: "Debit" | "Credit";
  transactionDate: string | null;
  bankAccount: string;
  candidateAccounts: ClassificationCandidateAccount[];
  similarPastClassifications: SimilarPastClassification[];
  /** Phase 28 — this company's own real historical evidence for
   * transactions structurally similar to this one (same narration
   * prefix, amount range, direction) — never requires the exact same
   * beneficiary to have appeared before, unlike `similarPastClassifications`
   * above. Empty array when no such history exists yet — a real, honest
   * answer, never omitted or fabricated. */
  companyHistoricalPatterns: CompanyHistoricalPatternForAi[];
};

/** The model's raw structured output, BEFORE this module's own
 * validation (`classification-engine.ts`) checks `accountCode` is
 * actually one of the `candidateAccounts` offered — never trusted as-is,
 * exactly like `gateway-provider.ts`'s own `sanitizeVyronAiResponse`
 * precedent for "never blindly trust arbitrary provider JSON." */
export type RawTransactionClassification = {
  /** `null` is a legitimate, honest answer — "none of the offered
   * accounts confidently fit" — never forced into a guess. */
  accountCode: string | null;
  /** 0-100. Always present, even when `accountCode` is null (0 in that
   * case) — the model's own stated certainty, taken as-is; VYRON never
   * fabricates a number the model didn't return. */
  confidence: number;
  /** One or two sentences, user-safe — never raw chain-of-thought. */
  explanation: string;
  /** Not part of the model's answer: token/cost figures the SDK or
   * gateway actually reported for this request, added by the provider. */
  usage?: ProviderUsage | null;
};

/** The deterministic bucketing this ticket requires ("must be
 * explainable and deterministic around the model output" — never a
 * percentage the model invents its own label for). Thresholds are
 * VYRON's own policy, not the model's. */
export type ConfidenceLevel = "High" | "Medium" | "Low";

const HIGH_CONFIDENCE_THRESHOLD = 85;
const MEDIUM_CONFIDENCE_THRESHOLD = 60;

export function confidenceLevelFor(confidence: number): ConfidenceLevel {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return "High";
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) return "Medium";
  return "Low";
}

/** The validated, ready-to-persist result — `classification-engine.ts`'s
 * output. `accountCode: null` (nothing to persist) is a real, expected
 * outcome, never treated as an error. */
export type TransactionClassificationResult = {
  transactionId: number;
  companyId: string;
  accountCode: string | null;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  explanation: string;
  modelUsed: string;
  /** Phase 28 — the accounting-evidence-based assessment
   * (`accounting-confidence.ts`) computed alongside the model's own raw
   * confidence above. `transaction-classification-service.ts` now
   * decides Suggested/Allocated/no-confident-suggestion from THIS, not
   * from `confidenceLevel` — see that file's own `targetStatusFor`. */
  accountingConfidence: AccountingConfidenceAssessment;
  /** Token/cost figures reported for this request, when supplied. */
  usage?: ProviderUsage | null;
};

/** Failures use the EXISTING `AIProviderError`/`classifyProviderError`
 * from `@/server/ai/types` and `@/server/ai/providers/gateway-provider`
 * directly — the failure-mode vocabulary (missing-api-key/timeout/
 * rate-limit/provider-error/malformed-response) is generic to "a Gateway
 * call failed," not specific to VYRON AI's Q&A shape, so it is reused
 * rather than duplicated with a second, parallel error class. */

/** The provider abstraction for this capability — same "the provider
 * must be replaceable" principle as `AIProvider`, kept as its own type
 * rather than widening `AIProvider` itself to cover two unrelated output
 * shapes. */
export type TransactionClassificationProvider = {
  classify(evidence: TransactionClassificationEvidence): Promise<RawTransactionClassification>;
};
