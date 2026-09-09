/**
 * Shared, framework-free classification logic for "what does this
 * transaction need, in plain language" — no I/O, no new database
 * status, no new engine. Originally built for Phase 8's guided Bank
 * Statement Processing flow, reused unchanged by Phase 9's Transaction
 * Intelligence Workspace, since both need the exact same real
 * classification of a `BankTransactionRecord`.
 *
 * Every group is built entirely from real fields the Matching/
 * Allocation/Banking Rules Engines and Banking Exceptions already write:
 *   - `requiredAction` / `allocationStatus` / `reviewStatus` — the same
 *     real fields `transaction-grid.tsx::computeMatchStatus` already
 *     reads for its own status badge (see that function's own docstring
 *     for the same "most attention-worthy first" precedence this
 *     mirrors).
 *   - Open Banking Exceptions of type `PossibleDuplicate`/
 *     `LargeUnusualPayment` — the real signals `banking-intelligence.ts`
 *     already raises at rule-processing time (see
 *     `rule-processing-service.ts::raiseIntelligenceExceptions`).
 * The six group names here (Ready/Matched/Allocated/Possible
 * duplicate/Unusual/Needs review) are a presentation-only re-labelling
 * for a fast-processing review screen — not a new database value.
 *
 * Exception Intelligence review — investigated, deliberately kept
 * separate from `server/financial-intelligence/*`'s `Finding`/
 * `BusinessSituation` system: this classifier operates on ONE
 * transaction at a time with a real "decide and move to next" workflow
 * (Accept/Reject via the existing bulk-review action) — every group here
 * corresponds to a specific, actionable transaction. Financial
 * Intelligence Findings (recurring transactions, customer concentration,
 * repeated corrections, VAT/Banking exceptions as company-wide signals)
 * are company- or pattern-level facts, several of which (recurring
 * patterns, customer concentration) don't correspond to any single
 * transaction a user could "accept or reject" here. Bridging them would
 * mean forcing two genuinely different review paradigms (per-transaction
 * triage vs. company-wide analysis) into one queue — not done.
 */

import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "@/server/accounting/matching-engine";
import type { BankTransactionRecord } from "@/server/accounting/types";
import type { ExceptionType } from "@/server/banking-rules/types";
export { EXCEPTION_LABEL } from "@/components/financial/banking-rules/banking-exceptions-tab";

export type ReviewGroupKey = "possibleDuplicate" | "unusual" | "needsReview" | "matched" | "allocated" | "ready";

export const REVIEW_GROUPS_ORDER: ReviewGroupKey[] = ["possibleDuplicate", "unusual", "needsReview", "matched", "allocated", "ready"];

export const REVIEW_GROUP_LABELS: Record<ReviewGroupKey, string> = {
  possibleDuplicate: "Possible duplicate",
  unusual: "Unusual",
  needsReview: "Needs review",
  matched: "Matched",
  allocated: "Allocated",
  ready: "Ready",
};

export const REVIEW_GROUP_TONE: Record<ReviewGroupKey, "good" | "warn" | "info" | "muted"> = {
  possibleDuplicate: "warn",
  unusual: "warn",
  needsReview: "info",
  matched: "good",
  allocated: "good",
  ready: "muted",
};

/** The groups a person should actually look at before moving on —
 * everything except the two "nothing to do" resting states. */
export const ATTENTION_GROUPS: ReviewGroupKey[] = ["possibleDuplicate", "unusual", "needsReview"];

/**
 * Classifies one transaction into exactly one of the six real groups
 * above. `openExceptionTypes` is every OPEN Banking Exception type
 * raised against this specific transaction (usually 0 or 1). Precedence
 * mirrors `computeMatchStatus` in transaction-grid.tsx: duplicate
 * concerns outrank everything, an explicit required action or open
 * exception outranks the merely-informational fact that something
 * already matched, and Matched/Allocated/Ready are the resting states.
 */
export function classifyForReview(
  transaction: Pick<BankTransactionRecord, "requiredAction" | "allocationStatus" | "reviewStatus">,
  openExceptionTypes: ExceptionType[],
): ReviewGroupKey {
  if (transaction.requiredAction === REQUIRED_ACTION_DUPLICATE_PAYMENT || openExceptionTypes.includes("PossibleDuplicate")) {
    return "possibleDuplicate";
  }
  if (openExceptionTypes.includes("LargeUnusualPayment")) {
    return "unusual";
  }
  if (transaction.requiredAction || openExceptionTypes.length > 0) {
    return "needsReview";
  }
  if (transaction.allocationStatus === "Suggested" && transaction.reviewStatus === null) {
    return "needsReview";
  }
  if (transaction.allocationStatus === "Matched") {
    return "matched";
  }
  if (transaction.allocationStatus === "Allocated") {
    return "allocated";
  }
  return "ready";
}

/** Honest "suggested action" text for one transaction, built only from
 * real fields already on the record — never a fabricated recommendation. */
export function suggestedActionFor(transaction: Pick<BankTransactionRecord, "requiredAction" | "allocationReason" | "matchReason">): string {
  return transaction.requiredAction || transaction.allocationReason || transaction.matchReason || "No suggested action available yet.";
}

export type RecommendedActionKind = "open-detail" | "link";
export type RecommendedAction = { label: string; kind: RecommendedActionKind; href?: string };

/**
 * Phase 9 — Transaction Intelligence Workspace. One primary call-to-
 * action per transaction, built only from real signals already on the
 * record (never an invented AI recommendation). `kind: "open-detail"`
 * means the existing read-only `TransactionDetailPanel` (with its real
 * Accept/Reject actions) is the right next step; `kind: "link"` means
 * the real mechanism lives on another existing page, so this routes
 * there instead of reimplementing it.
 */
export function recommendedActionFor(
  group: ReviewGroupKey,
  transaction: Pick<BankTransactionRecord, "allocationStatus" | "ruleId">,
  companyId: string,
): RecommendedAction {
  if (group === "possibleDuplicate") return { label: "Review Possible Duplicate", kind: "open-detail" };
  if (group === "unusual") return { label: "Review Unusual Payment", kind: "open-detail" };
  if (group === "needsReview") {
    if (transaction.ruleId !== null) return { label: "Review Banking Rule", kind: "link", href: `/company/${companyId}/banking-rules` };
    if (transaction.allocationStatus === "Suggested") return { label: "Match Transaction", kind: "open-detail" };
    return { label: "Review transaction", kind: "open-detail" };
  }
  if (group === "ready") return { label: "Allocate Transaction", kind: "link", href: `/company/${companyId}/transactions` };
  return { label: "Review transaction", kind: "open-detail" };
}

export type StepKey = "upload" | "analyse" | "review" | "allocate" | "reconcile";
export type StepStatus = "complete" | "current" | "upcoming";

export const STEPS: { key: StepKey; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "analyse", label: "Analyse" },
  { key: "review", label: "Review" },
  { key: "allocate", label: "Allocate / Match" },
  { key: "reconcile", label: "Reconcile" },
];

/**
 * A step is only ever "complete" when something the existing system
 * already produced proves it — never advanced optimistically. Upload and
 * Analyse become true together because the existing import endpoints
 * genuinely parse-and-validate as part of the same call that proves the
 * upload happened (the PDF preview call and the CSV/XLSX/OFX/QIF commit
 * call both do this in one round trip) — there is no real intermediate
 * "uploaded but not yet analysed" state to report honestly.
 */
export function computeStepStatuses(input: {
  hasUploaded: boolean;
  hasAnalysis: boolean;
  groupsLoaded: boolean;
  attentionCount: number;
  reconciled: boolean;
}): Record<StepKey, StepStatus> {
  const complete: Record<StepKey, boolean> = {
    upload: input.hasUploaded,
    analyse: input.hasAnalysis,
    review: input.groupsLoaded,
    allocate: input.groupsLoaded && input.attentionCount === 0,
    reconcile: input.groupsLoaded && input.reconciled,
  };
  const order: StepKey[] = ["upload", "analyse", "review", "allocate", "reconcile"];
  const firstIncompleteIndex = order.findIndex((key) => !complete[key]);
  const currentIndex = firstIncompleteIndex === -1 ? order.length - 1 : firstIncompleteIndex;

  const result = {} as Record<StepKey, StepStatus>;
  order.forEach((key, index) => {
    result[key] = complete[key] ? "complete" : index === currentIndex ? "current" : "upcoming";
  });
  return result;
}
