"use client";

import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { IconChevronLeft } from "@/components/ui/icons";
import { TransactionRecoveryPanel } from "./transaction-recovery-panel";
import { TransactionTimeline } from "./transaction-timeline";
import type { AllocationStatus, TransactionDetail } from "@/server/accounting/types";

const STATUS_TONE: Record<AllocationStatus, "good" | "info" | "warn" | "muted"> = {
  Matched: "good",
  Allocated: "info",
  Suggested: "warn",
  Unallocated: "muted",
};

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
  previewMode,
}: {
  detail: TransactionDetail | null;
  loading: boolean;
  onClose: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onLearnRule?: () => void;
  previewMode?: boolean;
}) {
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-detail-heading"
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-vf-paper p-6 shadow-2xl"
      >
        <button type="button" onClick={onClose} className="mb-4 flex items-center gap-1 self-start text-sm text-vf-ink-faint hover:text-vf-ink">
          <IconChevronLeft className="h-4 w-4" />
          Close
        </button>

        {loading && <p className="text-sm text-vf-ink-faint">Loading transaction…</p>}

        {detail && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 id="transaction-detail-heading" className="text-lg font-semibold text-vf-ink">
                {detail.transaction.description || "Transaction"}
              </h2>
              <p className="text-sm text-vf-ink-faint">{detail.transaction.transactionDate} · {detail.transaction.reference || "No reference"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[detail.transaction.allocationStatus]}>{detail.transaction.allocationStatus}</Badge>
                {detail.transaction.reviewStatus && <Badge tone="info">{detail.transaction.reviewStatus}</Badge>}
                {detail.journal && <Badge tone="muted">{detail.journal.journalNumber} ({detail.journal.status})</Badge>}
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
              <div>
                <dt className="text-xs text-vf-ink-faint">GL Account</dt>
                <dd className="text-vf-ink">{detail.transaction.suggestedGlAccount ?? "Not yet assigned"}</dd>
              </div>
              <div>
                <dt className="text-xs text-vf-ink-faint">VAT Treatment</dt>
                <dd className="text-vf-ink">{detail.transaction.suggestedVatCode ?? "Not yet assigned"}</dd>
              </div>
            </dl>

            <TransactionRecoveryPanel
              detail={detail}
              onAccept={() => onAccept?.()}
              onReject={() => onReject?.()}
              onLearnRule={onLearnRule}
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
