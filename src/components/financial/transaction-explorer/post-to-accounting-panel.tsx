"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionRow } from "@/components/ui/confirm-action";
import { transactionPostingStatus, type BankTransactionRecord } from "@/server/accounting/types";
import type { BulkSaveSummary } from "./transaction-grid";

/**
 * "Post to Accounting" — the action that takes processed bank
 * transactions into the General Ledger, and the step the banking
 * workflow previously had no button for at all.
 *
 * Three deliberate properties:
 *
 * 1. The button states its own blast radius ("Post to Accounting (17)")
 *    from the SAME `transactionPostingStatus` the server uses, so the
 *    count on the button is the count that will post.
 *
 * 2. Confirmation is driven by a server PREVIEW, not by the client's
 *    guess. The dialog shows how many journals will be created, over
 *    which dates, and — crucially — every transaction that will NOT post
 *    and why, before anything is written.
 *
 * 3. The result is reported in the four categories that mean different
 *    things to an accountant: posted, already posted, not ready, and
 *    needs attention. Nothing is summarised away.
 *
 * 4. It SAVES FIRST. An accountant who has just classified rows on screen
 *    should not have to press a separate "commit my classification"
 *    button before pressing this one — that was double work for a single
 *    intention, and it is what this panel now does itself: any unsaved
 *    allocation edit is committed through the ordinary allocate-row write
 *    path, the page is refreshed, and only then is the posting preview
 *    taken. Saving and posting remain two distinct accounting operations
 *    with their own audit trails; what changed is that one click performs
 *    both, in the right order. "Save Selected" still exists for saving
 *    WITHOUT posting.
 */

const EMPTY_IDS: Set<number> = new Set();

type Exclusion = { transactionId: number; reason: string };

type PostingPreview = {
  readyCount: number;
  journalCount: number;
  journals: { journalDate: string; transactionCount: number }[];
  alreadyPosted: Exclusion[];
  notReady: Exclusion[];
  blocked: Exclusion[];
};

type PostingOutcome = {
  batch: { batchNumber: string } | null;
  posted: { transactionId: number; journalId: number; journalNumber: string }[];
  journals: { id: number; journalNumber: string; journalDate: string; transactionCount: number }[];
  alreadyPosted: Exclusion[];
  notReady: Exclusion[];
  blocked: Exclusion[];
};

/** Groups exclusions by reason so a batch of 141 transactions blocked for
 * one reason reads as one line, not 141 — while still naming the count. */
function summariseReasons(exclusions: Exclusion[]): { reason: string; count: number }[] {
  const byReason = new Map<string, number>();
  for (const e of exclusions) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  return [...byReason.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

function ReasonList({ label, exclusions, tone }: { label: string; exclusions: Exclusion[]; tone: "muted" | "warn" | "danger" | "good" }) {
  if (exclusions.length === 0) return null;
  const toneClass = tone === "danger" ? "text-vf-danger" : tone === "warn" ? "text-vf-warning" : tone === "good" ? "text-vf-success" : "text-vf-ink-faint";
  return (
    <div className="flex flex-col gap-0.5">
      <p className={`text-xs font-medium ${toneClass}`}>
        {label} ({exclusions.length})
      </p>
      <ul className="flex flex-col gap-0.5 pl-3">
        {summariseReasons(exclusions).map(({ reason, count }) => (
          <li key={reason} className="text-xs text-vf-ink-soft">
            {count} × {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PostToAccountingPanel({
  companyId,
  selected,
  disabled,
  disabledTitle,
  onPosted,
  pendingAllocationIds = EMPTY_IDS,
  onCommitPendingAllocations,
  summarizeSave,
}: {
  companyId: string;
  selected: BankTransactionRecord[];
  disabled: boolean;
  disabledTitle?: string;
  /** Fired once the ledger has actually been written, so the parent can
   * refetch — a posted transaction's status, journal link and posting
   * batch all change. */
  onPosted: () => void | Promise<void>;
  /** Rows carrying an unsaved allocation edit the grid will accept. They
   * count towards this button because pressing it commits them first —
   * without this the button would read "(0)" and sit disabled over work
   * the accountant can plainly see on screen. */
  pendingAllocationIds?: Set<number>;
  /** Commits those edits (the ordinary allocate-row path) and refreshes
   * the page, before any posting preview is taken. */
  onCommitPendingAllocations?: () => Promise<BulkSaveSummary | null>;
  summarizeSave?: (summary: BulkSaveSummary) => string;
}) {
  const [preview, setPreview] = useState<PostingPreview | null>(null);
  const [outcome, setOutcome] = useState<PostingOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSummary, setSaveSummary] = useState<BulkSaveSummary | null>(null);
  /** The ids this run is acting on, captured BEFORE the save-and-refetch
   * so a refreshed page (or a cleared selection) cannot change what the
   * confirmation dialog is about to post. */
  const [targetIds, setTargetIds] = useState<number[]>([]);

  // Client-side count for the button label only — the server independently
  // re-derives it and is the authority on what actually posts.
  const readyCount = selected.filter((t) => transactionPostingStatus(t) === "Ready to Post" || pendingAllocationIds.has(t.id)).length;
  const postedCount = selected.filter((t) => {
    const status = transactionPostingStatus(t);
    return status === "Posted" || status === "Reconciled";
  }).length;

  async function call(transactionIds: number[], body: Record<string, unknown>) {
    const res = await fetch(`/api/companies/${companyId}/transactions/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionIds, ...body }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  }

  async function startPreview() {
    setLoading(true);
    setError(null);
    setOutcome(null);
    setSaveSummary(null);
    const ids = selected.map((t) => t.id);
    setTargetIds(ids);
    try {
      // Save first. A row whose allocation failed to save is not dropped
      // and not hidden: it simply is not yet allocated, so the preview
      // below reports it as not ready, with its own reason — and the save
      // failures are shown alongside.
      if (onCommitPendingAllocations) {
        const summary = await onCommitPendingAllocations();
        if (summary && (summary.saved > 0 || summary.failed.length > 0)) setSaveSummary(summary);
      }
      setPreview((await call(ids, { preview: true })) as PostingPreview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the API.");
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    setLoading(true);
    setError(null);
    try {
      const json = await call(targetIds, {});
      setPreview(null);
      setOutcome(json.outcome as PostingOutcome);
      await onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the API.");
    } finally {
      setLoading(false);
    }
  }

  const pendingHere = selected.filter((t) => pendingAllocationIds.has(t.id)).length;
  const buttonTitle =
    disabledTitle ??
    (readyCount === 0
      ? postedCount === selected.length && selected.length > 0
        ? "Every selected transaction has already been posted to the General Ledger."
        : "No selected transaction is ready to post — allocate it to a GL account, a supplier or a customer first."
      : pendingHere > 0
        ? `Save ${pendingHere} unsaved allocation${pendingHere === 1 ? "" : "s"}, then create journals and General Ledger entries for ${readyCount} transaction${readyCount === 1 ? "" : "s"}`
        : `Create journals and General Ledger entries for ${readyCount} transaction${readyCount === 1 ? "" : "s"}`);

  return (
    <>
      <Button variant="primary" size="sm" disabled={disabled || loading || readyCount === 0} title={buttonTitle} onClick={startPreview}>
        {loading && !preview ? (pendingHere > 0 ? "Saving…" : "Checking…") : `Post to Accounting${readyCount > 0 ? ` (${readyCount})` : ""}`}
      </Button>

      {saveSummary && summarizeSave && (
        <p className={`w-full text-xs ${saveSummary.failed.length > 0 ? "text-vf-danger" : "text-vf-ink-soft"}`}>
          {saveSummary.failed.length > 0 ? "! " : "✓ "}
          {summarizeSave(saveSummary)}
          {saveSummary.failed.length > 0 ? " — those rows stay unallocated and are listed as not ready below." : " Saved before posting."}
        </p>
      )}

      {preview && (
        <div className="w-full">
          <ConfirmActionRow
            layout="panel"
            message={
              preview.readyCount === 0
                ? "Nothing in this selection can be posted."
                : `Post ${preview.readyCount} transaction${preview.readyCount === 1 ? "" : "s"} to the General Ledger, in ${preview.journalCount} journal${preview.journalCount === 1 ? "" : "s"}?`
            }
            itemsPreview={
              <div className="flex flex-col gap-2">
                {preview.journals.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    <p className="text-xs font-medium text-vf-ink-soft">
                      One journal per transaction date, so each entry lands in its own financial period:
                    </p>
                    <ul className="flex flex-col gap-0.5 pl-3">
                      {preview.journals.slice(0, 8).map((j) => (
                        <li key={j.journalDate} className="text-xs text-vf-ink-soft">
                          {j.journalDate} — {j.transactionCount} transaction{j.transactionCount === 1 ? "" : "s"}
                        </li>
                      ))}
                      {preview.journals.length > 8 && <li className="text-xs text-vf-ink-faint">…and {preview.journals.length - 8} more dates</li>}
                    </ul>
                  </div>
                )}
                <ReasonList label="Already posted — will be left unchanged" exclusions={preview.alreadyPosted} tone="muted" />
                <ReasonList label="Not ready to post" exclusions={preview.notReady} tone="warn" />
                <ReasonList label="Needs attention before posting" exclusions={preview.blocked} tone="danger" />
              </div>
            }
            confirmLabel={`Post ${preview.readyCount} to Accounting`}
            confirmingLabel="Posting…"
            loading={loading}
            error={error}
            onConfirm={commit}
            onCancel={() => {
              setPreview(null);
              setError(null);
              setSaveSummary(null);
            }}
          />
        </div>
      )}

      {outcome && (
        <div className="flex w-full flex-col gap-2 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt/60 px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={outcome.posted.length > 0 ? "good" : "muted"}>
              {outcome.posted.length} posted successfully
            </Badge>
            {outcome.alreadyPosted.length > 0 && <Badge tone="muted">{outcome.alreadyPosted.length} already posted</Badge>}
            {outcome.notReady.length > 0 && <Badge tone="warn">{outcome.notReady.length} not ready</Badge>}
            {outcome.blocked.length > 0 && <Badge tone="warn">{outcome.blocked.length} need attention</Badge>}
            <Button variant="subtle" size="sm" onClick={() => setOutcome(null)}>
              Dismiss
            </Button>
          </div>
          {outcome.batch && (
            <p className="text-xs text-vf-ink-soft">
              Posting batch <span className="font-mono">{outcome.batch.batchNumber}</span> — {outcome.journals.length} journal
              {outcome.journals.length === 1 ? "" : "s"}:{" "}
              <span className="font-mono">{outcome.journals.slice(0, 6).map((j) => j.journalNumber).join(", ")}</span>
              {outcome.journals.length > 6 ? ` …+${outcome.journals.length - 6}` : ""}. These transactions now appear in the General Ledger, Trial Balance and financial reports.
            </p>
          )}
          <ReasonList label="Already posted" exclusions={outcome.alreadyPosted} tone="muted" />
          <ReasonList label="Not ready to post" exclusions={outcome.notReady} tone="warn" />
          <ReasonList label="Needs attention" exclusions={outcome.blocked} tone="danger" />
          {error && <p className="text-xs text-vf-danger">{error}</p>}
        </div>
      )}

      {error && !preview && !outcome && <p className="w-full text-xs text-vf-danger">{error}</p>}
    </>
  );
}
