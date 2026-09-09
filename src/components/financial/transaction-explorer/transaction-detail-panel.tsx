"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { IconChevronLeft } from "@/components/ui/icons";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { TransactionRecoveryPanel } from "./transaction-recovery-panel";
import { TransactionTimeline } from "./transaction-timeline";
import { EXCEPTION_LABEL } from "@/components/financial/banking-rules/banking-exceptions-tab";
import { computeMatchStatus, POSTING_STATUS_TONE } from "./transaction-grid";
import { transactionPostingStatus, type TransactionDetail } from "@/server/accounting/types";
import type { BankingException } from "@/server/banking-rules/types";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function TransactionDetailPanel({
  detail,
  loading,
  onClose,
  onAccept,
  onReject,
  onLearnRule,
  onClassifyWithAi,
  classifying,
  previewMode,
  exceptions,
  onSkip,
}: {
  detail: TransactionDetail | null;
  loading: boolean;
  onClose: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onLearnRule?: () => void;
  /** Phase 22B — see `TransactionRecoveryPanel`'s own docs. */
  onClassifyWithAi?: () => void;
  classifying?: boolean;
  previewMode?: boolean;
  /** Phase 9 — Transaction Intelligence Workspace. The OPEN Banking
   * Exceptions raised against this specific transaction, if the caller
   * has already loaded them — optional and additive so the main
   * Transaction Explorer grid's existing usage of this panel (which
   * doesn't load exceptions today) is unaffected. */
  exceptions?: BankingException[];
  /** Phase 9 — "Skip / Continue where the existing workflow supports
   * it." Pure navigation to the next queue item — no mutation, so it's
   * safe to offer even in preview mode. Omitted entirely (no button)
   * when the caller has no queue to advance through. */
  onSkip?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isOpen = Boolean(detail || loading);
  useFocusTrap(isOpen, panelRef);

  useEffect(() => {
    if (!detail && !loading) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [detail, loading, onClose]);

  if (!detail && !loading) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close transaction details" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-detail-heading"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-vf-paper p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <button type="button" onClick={onClose} className="flex items-center gap-1 self-start text-sm text-vf-ink-faint hover:text-vf-ink">
            <IconChevronLeft className="h-4 w-4" />
            Close
          </button>
          {onSkip && (
            <button type="button" onClick={onSkip} className="text-sm font-medium text-vf-red-600 hover:text-vf-red-700">
              Skip / Next →
            </button>
          )}
        </div>

        {loading && <p className="text-sm text-vf-ink-faint">Loading transaction…</p>}

        {detail && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 id="transaction-detail-heading" className="text-lg font-semibold text-vf-ink">
                {detail.transaction.description || "Transaction"}
              </h2>
              <p className="text-sm text-vf-ink-faint">{detail.transaction.transactionDate} · {detail.transaction.reference || "No reference"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Phase 28, Part 10 — was a bare allocationStatus badge
                    PLUS a separate, always-blue "AI Classified" tag that
                    never distinguished AI-Allocated from AI-Suggested and
                    never visually signalled "needs confirmation." Now the
                    SAME `computeMatchStatus` the grid uses — one
                    authoritative rendering rule for "what does this
                    transaction's state mean," not two independent ones
                    that could silently drift apart. `touched`/`invalid`
                    are grid-only, in-progress-edit concepts this
                    read-only panel has none of, so both are `false` here —
                    always the persisted, server-side state. */}
                <Badge tone={computeMatchStatus(detail.transaction, false, false).tone}>{computeMatchStatus(detail.transaction, false, false).label}</Badge>
                {/* Where this transaction sits in the accounting
                    workflow, which the matching badge beside it does not
                    answer: a Matched transaction may still be
                    Unprocessed, and a classified one is still not
                    Posted. Same derivation the grid column and the
                    filters use. */}
                <Badge tone={POSTING_STATUS_TONE[transactionPostingStatus(detail.transaction)]}>{transactionPostingStatus(detail.transaction)}</Badge>
                {detail.transaction.reviewStatus && <Badge tone="info">{detail.transaction.reviewStatus}</Badge>}
                {detail.journal && <Badge tone="muted">{detail.journal.journalNumber} ({detail.journal.status})</Badge>}
                {/* Phase 9 — Section 7: "If a transaction was processed by
                    an existing banking rule, show it... If it was not, do
                    not imply that a rule exists." Gated strictly on the
                    real `ruleId` foreign key, never on `rulesTriggered`
                    alone (the Matching Engine's own supplier/bill scoring
                    also populates that array, with no rule involved). */}
                {detail.transaction.ruleId !== null && (
                  <Badge tone="info">Processed by Banking Rule{detail.transaction.rulesTriggered.length > 0 ? ` — ${detail.transaction.rulesTriggered.join(", ")}` : ""}</Badge>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-vf-ink-faint">Debit</dt>
                <dd className="font-mono tabular-nums text-vf-ink">{detail.transaction.debit > 0 ? money(detail.transaction.debit) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">Credit</dt>
                <dd className="font-mono tabular-nums text-vf-ink">{detail.transaction.credit > 0 ? money(detail.transaction.credit) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">Balance</dt>
                <dd className="font-mono tabular-nums text-vf-ink">{detail.transaction.balance !== null ? money(detail.transaction.balance) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">Bank Account</dt>
                <dd className="text-vf-ink">{detail.bankAccount ? `${detail.bankAccount.accountName} (${detail.bankAccount.bankName})` : detail.transaction.bankAccount}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">Imported File</dt>
                <dd className="truncate text-vf-ink">{detail.transaction.sourceFilename || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">Import Batch</dt>
                <dd className="truncate text-vf-ink">{detail.transaction.importBatch || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">Supplier</dt>
                <dd className="text-vf-ink">{detail.matchedSupplier?.name ?? "Unmatched"}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">Customer</dt>
                <dd className="text-vf-ink">{detail.matchedCustomer?.name ?? "Unmatched"}</dd>
              </div>
              {/* The source's own account for this transaction — the
                  Xero export's "Related Account" for a migrated row.
                  Preserved verbatim from the import and never
                  overwritten by classification, so the evidence behind
                  an allocation stays visible after the allocation is
                  made. Distinct from "GL Account" below, which is
                  VYRON's own allocation. */}
              <div>
                <dt className="text-xs text-vf-ink-faint">Source Account (as imported)</dt>
                <dd className="text-vf-ink-soft">{detail.transaction.glAccount?.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">GL Account</dt>
                <dd className="text-vf-ink">{detail.transaction.suggestedGlAccount ?? "Not yet assigned"}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">VAT Treatment</dt>
                <dd className="text-vf-ink">{detail.transaction.suggestedVatCode ?? "Not yet assigned"}</dd>
              </div>
            </dl>

            {/* Phase 9 — Section 4/8/9: "Existing exception information",
                duplicate/unusual intelligence. Real Banking Exceptions
                only, filtered by the caller to this transaction — never
                a fabricated concern. */}
            {exceptions && exceptions.length > 0 && (
              <div className="flex flex-col gap-2 rounded-vf-md border border-vf-warning/30 bg-vf-warning/5 p-4">
                <h3 className="text-sm font-semibold text-vf-ink">Exceptions</h3>
                <ul className="flex flex-col gap-2">
                  {exceptions.map((exc) => (
                    <li key={exc.id} className="border-t border-vf-warning/20 pt-2 text-sm first:border-0 first:pt-0">
                      <div className="flex items-center gap-2">
                        <Badge tone="warn">{EXCEPTION_LABEL[exc.exceptionType]}</Badge>
                        <Badge tone={exc.status === "Open" ? "warn" : exc.status === "Resolved" ? "good" : "muted"}>{exc.status}</Badge>
                      </div>
                      <p className="mt-1 text-vf-ink-soft">{exc.reason}</p>
                      {exc.recommendedAction && <p className="mt-0.5 text-xs text-vf-ink-faint">Recommended: {exc.recommendedAction}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <TransactionRecoveryPanel
              detail={detail}
              onAccept={() => onAccept?.()}
              onReject={() => onReject?.()}
              onLearnRule={onLearnRule}
              onClassifyWithAi={onClassifyWithAi}
              classifying={classifying}
              previewMode={previewMode ?? false}
            />

            <div>
              <h3 className="mb-3 text-sm font-semibold text-vf-ink">Timeline</h3>
              <TransactionTimeline detail={detail} />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-vf-ink">Match History</h3>
              {detail.matchHistory.length === 0 ? (
                <p className="text-xs text-vf-ink-faint">No matching decisions recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-xs text-vf-ink-soft">
                  {detail.matchHistory.map((h) => (
                    <li key={h.id} className="border-t border-vf-paper-border pt-2 first:border-0 first:pt-0">
                      {h.previousStatus ?? "—"} → {h.newStatus} ({h.confidence ?? 0}%) — {h.reason} · {new Date(h.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-vf-ink">Allocation History</h3>
              {detail.allocationHistory.length === 0 ? (
                <p className="text-xs text-vf-ink-faint">No allocation decisions recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-xs text-vf-ink-soft">
                  {detail.allocationHistory.map((h) => (
                    <li key={h.id} className="border-t border-vf-paper-border pt-2 first:border-0 first:pt-0">
                      {h.previousStatus ?? "—"} → {h.newStatus} · GL {h.previousGlAccount ?? "—"} → {h.newGlAccount ?? "—"} · {h.allocationReason}
                      {h.confidence !== null && ` (${h.confidence}% confidence)`}
                      {h.isManualOverride && " (manual)"} · {new Date(h.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-vf-ink">Review History</h3>
              {detail.reviewHistory.length === 0 ? (
                <p className="text-xs text-vf-ink-faint">No manual review recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-xs text-vf-ink-soft">
                  {detail.reviewHistory.map((h) => (
                    <li key={h.id} className="border-t border-vf-paper-border pt-2 first:border-0 first:pt-0">
                      {h.previousReviewStatus ?? "—"} → {h.newReviewStatus} by {h.performedBy}
                      {h.note && ` — "${h.note}"`} · {new Date(h.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
