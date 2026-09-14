"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { glAccountOptions, vatCodeOptions } from "@/lib/account-picker-options";
import { IconChevronLeft } from "@/components/ui/icons";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { TransactionRecoveryPanel } from "./transaction-recovery-panel";
import { TransactionTimeline } from "./transaction-timeline";
import { EXCEPTION_LABEL } from "@/components/financial/banking-rules/banking-exceptions-tab";
import { computeMatchStatus, POSTING_STATUS_TONE } from "./transaction-grid";
import { transactionPostingStatus, type Supplier, type TransactionDetail } from "@/server/accounting/types";
import type { BankingException } from "@/server/banking-rules/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import type { AllocateRowPayload } from "./transaction-grid";
import { ModalPortal } from "@/components/ui/modal-portal";
import { formatAmount, formatDateTime } from "@/lib/format";

function money(value: number): string {
  return formatAmount(value);
}

/**
 * The Update action for a single transaction.
 *
 * Deliberately NOT a new update mechanism. It builds the same
 * `AllocateRowPayload` the inline grid builds and hands it to the same
 * `allocate-row` endpoint -> `transaction-explorer-service.ts::allocateRow`
 * -> `bulkUpdateWithAllocationHistory`, so every existing safeguard still
 * applies: a posted transaction is refused by the repository's own
 * `journal_id IS NULL` claim (surfaced as a 409), the review-hold guard
 * stands, and an `ae_allocation_history` row is still written for the
 * audit trail.
 *
 * The imported Xero evidence is not reachable from this payload:
 * `gl_account` (the source's own account), the amounts, the date, the
 * reference and `source_occurrence` are not fields it carries and cannot
 * be changed by it. Updating never posts to accounting.
 *
 * Until now this workflow existed only as a per-cell "Save" that appeared
 * in the grid after you had already started editing a cell — there was no
 * visible, labelled way to update a transaction you had opened.
 */
function UpdateAllocationForm({
  detail,
  onUpdate,
  chartOfAccounts,
  vatTreatments,
  suppliers,
  customers,
  previewMode,
}: {
  detail: TransactionDetail;
  onUpdate: (input: AllocateRowPayload) => Promise<{ ok: true } | { ok: false; error: string }>;
  chartOfAccounts: ChartOfAccount[];
  vatTreatments: VatTreatment[];
  suppliers: Supplier[];
  customers: { id: number; name: string }[];
  previewMode?: boolean;
}) {
  const t = detail.transaction;
  const [type, setType] = useState<"G" | "C" | "S" | "">(t.allocationType ?? "");
  const [accountCode, setAccountCode] = useState<string>(t.suggestedGlAccount ?? "");
  const [supplierId, setSupplierId] = useState<string>(t.matchedSupplierId !== null ? String(t.matchedSupplierId) : "");
  const [customerId, setCustomerId] = useState<string>(t.matchedCustomerId !== null ? String(t.matchedCustomerId) : "");
  const [vatCode, setVatCode] = useState<string>(t.suggestedVatCode ?? "");
  const [notes, setNotes] = useState<string>(t.allocationNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const glOptions = useMemo(() => glAccountOptions(chartOfAccounts), [chartOfAccounts]);
  const vatOptions = useMemo(() => vatCodeOptions(vatTreatments), [vatTreatments]);

  // A posted transaction is immutable — the server enforces this, and
  // saying so up front is clearer than letting the click fail with a 409.
  const posted = t.postedFlag || t.reconciliationId !== null;
  // An allocation attempt must name its target; a notes-only edit is a
  // legitimate save on its own (the same rule the grid's `commitRow` uses).
  const incomplete = (type === "G" && !accountCode.trim()) || (type === "S" && !supplierId) || (type === "C" && !customerId);

  async function submit() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await onUpdate({
      type: type === "" ? null : type,
      accountCode: type === "G" ? accountCode.trim() || null : null,
      supplierId: type === "S" && supplierId ? Number(supplierId) : null,
      customerId: type === "C" && customerId ? Number(customerId) : null,
      vatCode: vatCode.trim() || null,
      allocationNotes: notes,
      // The description is not edited here, so it is explicitly
      // "unchanged, don't write it".
      description: null,
    });
    setSaving(false);
    if (result.ok) setSaved(true);
    else setError(result.error);
  }

  return (
    <section className="flex flex-col gap-3 rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-vf-ink">Update Allocation</h3>
        <Badge tone={POSTING_STATUS_TONE[transactionPostingStatus(t)]}>{transactionPostingStatus(t)}</Badge>
      </div>

      {posted ? (
        <p className="text-xs text-vf-ink-soft">
          This transaction has been posted to the General Ledger and can no longer be edited. Reverse its journal first if a
          correction is genuinely needed.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="upd-type" className="mb-1 block text-xs font-medium text-vf-ink-faint">Type</label>
              <Select id="upd-type" value={type} onChange={(e) => setType(e.target.value as "G" | "C" | "S" | "")}>
                <option value="">Unallocated</option>
                <option value="G">GL Account</option>
                <option value="S">Supplier</option>
                <option value="C">Customer</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">VAT Treatment</label>
              <Combobox aria-label="VAT treatment" value={vatCode || null} options={vatOptions} onCommit={(v) => setVatCode(v ?? "")} placeholder="No VAT treatment" />
            </div>
          </div>

          {type === "G" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-vf-ink-faint">GL Account</label>
              <Combobox aria-label="GL account" value={accountCode || null} options={glOptions} onCommit={(v) => setAccountCode(v ?? "")} placeholder="Choose an account" />
            </div>
          )}
          {type === "S" && (
            <div>
              <label htmlFor="upd-supplier" className="mb-1 block text-xs font-medium text-vf-ink-faint">Supplier</label>
              <Select id="upd-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose a supplier</option>
                {suppliers.map((sup) => (
                  <option key={sup.id} value={sup.id}>{sup.name}</option>
                ))}
              </Select>
            </div>
          )}
          {type === "C" && (
            <div>
              <label htmlFor="upd-customer" className="mb-1 block text-xs font-medium text-vf-ink-faint">Customer</label>
              <Select id="upd-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Choose a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <label htmlFor="upd-notes" className="mb-1 block text-xs font-medium text-vf-ink-faint">Allocation Notes</label>
            <Input id="upd-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this allocation (optional)" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              disabled={previewMode || saving || incomplete}
              title={
                previewMode
                  ? "Available once a production Supabase project is connected"
                  : incomplete
                    ? "Choose an account, supplier or customer before updating"
                    : "Save these changes to this transaction"
              }
              onClick={submit}
            >
              {saving ? "Updating…" : "Update"}
            </Button>
            {saved && <span className="text-xs text-vf-success">Updated.</span>}
            {error && <span className="text-xs text-vf-danger">{error}</span>}
          </div>

          <p className="text-xs text-vf-ink-faint">
            Updating changes only VYRON&apos;s allocation. The imported Xero source account, amount, date and reference are
            evidence and are never altered — and updating never posts to the General Ledger.
          </p>
        </>
      )}
    </section>
  );
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
  onUpdate,
  chartOfAccounts,
  vatTreatments,
  suppliers,
  customers,
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
  /** The Update action. Deliberately the SAME `AllocateRowPayload` the
   * inline grid commits through `allocateRowInline` — i.e. the existing
   * `allocate-row` endpoint, service and repository, with all of their
   * posted-transaction and review-hold guards intact. This panel does
   * not introduce a second update path; it gives the one that already
   * exists a visible, labelled entry point, which the grid only ever
   * exposed mid-edit as a per-cell "Save". */
  onUpdate?: (input: AllocateRowPayload) => Promise<{ ok: true } | { ok: false; error: string }>;
  chartOfAccounts?: ChartOfAccount[];
  vatTreatments?: VatTreatment[];
  suppliers?: Supplier[];
  customers?: { id: number; name: string }[];
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

  // Portaled to <body> so no hovered/transformed page ancestor (e.g. a
  // paper Card's hover lift) can become this fixed overlay's containing
  // block — see `ModalPortal`.
  return (
    <ModalPortal>
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

            {/* The Update action. Rendered whenever the caller supplies
                the handler and its option lists — keyed on the
                transaction id so opening a different transaction resets
                the form to that transaction's own current values rather
                than carrying the previous one's edits across. */}
            {onUpdate && chartOfAccounts && vatTreatments && (
              <UpdateAllocationForm
                key={detail.transaction.id}
                detail={detail}
                onUpdate={onUpdate}
                chartOfAccounts={chartOfAccounts}
                vatTreatments={vatTreatments}
                suppliers={suppliers ?? []}
                customers={customers ?? []}
                previewMode={previewMode}
              />
            )}

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
                      {h.previousStatus ?? "—"} → {h.newStatus} ({h.confidence ?? 0}%) — {h.reason} · {formatDateTime(h.createdAt)}
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
                      {h.isManualOverride && " (manual)"} · {formatDateTime(h.createdAt)}
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
                      {h.note && ` — "${h.note}"`} · {formatDateTime(h.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    </ModalPortal>
  );
}
