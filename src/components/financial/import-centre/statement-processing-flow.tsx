"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { ImportUploadCard, type StatementUploadPhase } from "@/components/financial/import-upload-card";
import { computeMatchStatus } from "@/components/financial/transaction-explorer/transaction-grid";
import {
  ATTENTION_GROUPS,
  REVIEW_GROUPS_ORDER,
  REVIEW_GROUP_LABELS,
  REVIEW_GROUP_TONE,
  STEPS,
  classifyForReview,
  computeStepStatuses,
  suggestedActionFor,
  type ReviewGroupKey,
  type StepKey,
  type StepStatus,
} from "@/components/financial/transaction-review-classification";
import { IconAlertTriangle } from "@/components/ui/icons";
import type { BankAccountSummary, BankTransactionRecord } from "@/server/accounting/types";
import type { BankingException, ExceptionType } from "@/server/banking-rules/types";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STEP_CIRCLE_TONE: Record<StepStatus, string> = {
  complete: "bg-vf-success text-white",
  current: "bg-vf-red-500 text-white",
  upcoming: "border border-vf-paper-border text-vf-ink-faint",
};

function StepperHeader({ statuses }: { statuses: Record<StepKey, StepStatus> }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-3">
      {STEPS.map((step, i) => {
        const status = statuses[step.key];
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", STEP_CIRCLE_TONE[status])}>
              {status === "complete" ? "✓" : i + 1}
            </span>
            <span className={cn("text-xs font-medium", status === "upcoming" ? "text-vf-ink-faint" : "text-vf-ink")}>{step.label}</span>
            {i < STEPS.length - 1 && (
              <span className="mx-0.5 text-vf-ink-faint" aria-hidden>
                →
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Phase 8 — Intelligent Bank Statement Processing. Wraps the existing,
 * unmodified `ImportUploadCard` (same upload mechanics, same API calls,
 * same PDF review flow) with a visible Upload → Analyse → Review →
 * Allocate/Match → Reconcile stepper and three additive panels — Review,
 * Allocate & Match, Reconcile — built entirely from real data fetched
 * through the EXISTING Transaction Explorer and Banking Exceptions list
 * APIs (`GET /transactions?importBatch=`, `GET /banking-exceptions`).
 * No new API route, parser, allocation mechanism, or matching engine.
 */
export function StatementProcessingFlow({
  companyId,
  previewMode,
  bankAccountSummaries,
}: {
  companyId: string;
  previewMode: boolean;
  bankAccountSummaries: BankAccountSummary[];
}) {
  const [phase, setPhase] = useState<StatementUploadPhase>({ phase: "idle" });
  const [transactions, setTransactions] = useState<BankTransactionRecord[] | null>(null);
  const [transactionsHasMore, setTransactionsHasMore] = useState(false);
  const [openExceptions, setOpenExceptions] = useState<BankingException[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  // Which batch the state above actually belongs to — lets "loading" be
  // derived (committed batch present, but not yet loaded for THIS batch)
  // instead of tracked as its own state flag set synchronously in the
  // effect below.
  const [loadedBatchId, setLoadedBatchId] = useState<string | null>(null);

  const committedBatchId = phase.phase === "committed" ? phase.batchId : null;
  const importedAt = phase.phase === "committed" ? phase.importedAt : null;
  const loadingGroups = committedBatchId !== null && loadedBatchId !== committedBatchId && groupsError === null;

  useEffect(() => {
    if (!committedBatchId || previewMode) return;
    let cancelled = false;
    (async () => {
      try {
        const [txRes, excRes] = await Promise.all([
          fetch(`/api/companies/${companyId}/transactions?importBatch=${encodeURIComponent(committedBatchId)}&pageSize=500`),
          fetch(`/api/companies/${companyId}/banking-exceptions?status=Open`),
        ]);
        if (!txRes.ok) throw new Error(`Couldn't load the imported transactions (status ${txRes.status}).`);
        if (!excRes.ok) throw new Error(`Couldn't load banking exceptions (status ${excRes.status}).`);
        const txBody: { transactions: BankTransactionRecord[]; hasMore: boolean } = await txRes.json();
        const excBody: { exceptions: BankingException[] } = await excRes.json();
        if (cancelled) return;
        setTransactions(txBody.transactions);
        setTransactionsHasMore(Boolean(txBody.hasMore));
        setOpenExceptions(excBody.exceptions);
        setLoadedBatchId(committedBatchId);
      } catch (err) {
        console.error("Statement review data failed to load", err);
        if (!cancelled) {
          setGroupsError(err instanceof Error ? err.message : "Couldn't load the review data for this import.");
          setLoadedBatchId(committedBatchId);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [committedBatchId, companyId, previewMode]);

  const exceptionsByTransaction = useMemo(() => {
    const map = new Map<number, ExceptionType[]>();
    for (const exc of openExceptions ?? []) {
      const list = map.get(exc.bankTransactionId) ?? [];
      list.push(exc.exceptionType);
      map.set(exc.bankTransactionId, list);
    }
    return map;
  }, [openExceptions]);

  const groups = useMemo(() => {
    const buckets: Record<ReviewGroupKey, BankTransactionRecord[]> = { possibleDuplicate: [], unusual: [], needsReview: [], matched: [], allocated: [], ready: [] };
    for (const t of transactions ?? []) {
      buckets[classifyForReview(t, exceptionsByTransaction.get(t.id) ?? [])].push(t);
    }
    return buckets;
  }, [transactions, exceptionsByTransaction]);

  const attentionItems = useMemo(() => ATTENTION_GROUPS.flatMap((key) => groups[key]), [groups]);

  const touchedAccountIds = useMemo(
    () => Array.from(new Set((transactions ?? []).map((t) => t.bankAccountId).filter((id): id is number => id !== null))),
    [transactions],
  );
  const touchedAccount = touchedAccountIds.length === 1 ? (bankAccountSummaries.find((s) => s.account.id === touchedAccountIds[0]) ?? null) : null;
  const reconciled = Boolean(
    touchedAccount?.account.lastReconciliationDate && importedAt && touchedAccount.account.lastReconciliationDate >= importedAt.slice(0, 10),
  );

  const groupsLoaded = transactions !== null && openExceptions !== null;
  const stepStatuses = computeStepStatuses({
    hasUploaded: phase.phase === "pdf-preview" || phase.phase === "committed",
    hasAnalysis: phase.phase === "pdf-preview" || phase.phase === "committed",
    groupsLoaded,
    attentionCount: attentionItems.length,
    reconciled,
  });

  const transactionExplorerHref = committedBatchId ? `/company/${companyId}/transactions?importBatch=${encodeURIComponent(committedBatchId)}` : `/company/${companyId}/transactions`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bank Statement</CardTitle>
        <CardDescription>Upload → Analyse → Review → Allocate/Match → Reconcile — the same import you already use, walked through step by step.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-0">
        <StepperHeader statuses={stepStatuses} />

        <ImportUploadCard
          companyId={companyId}
          kind="bank-transactions"
          title="Bank Statement"
          description="Standard VYRON Bank Import Template (CSV or Excel), OFX, QIF, or PDF."
          templateHint="Supported formats: CSV, Excel, OFX, QIF, PDF. The bank account is detected automatically from the statement — there's no separate account picker. PDF statements go through a review step before anything is committed. Balance and VAT are optional but must be numbers if provided."
          previewMode={previewMode}
          onPhaseChange={setPhase}
        />

        {committedBatchId && (
          <>
            {/* Step 3 — Review */}
            <div className="flex flex-col gap-3 border-t border-vf-paper-border pt-5">
              <div>
                <h3 className="text-sm font-semibold text-vf-ink">Review</h3>
                <p className="text-xs text-vf-ink-faint">Every transaction from this import, grouped by its real status.</p>
              </div>
              {loadingGroups ? (
                <p className="text-sm text-vf-ink-faint">Loading…</p>
              ) : groupsError ? (
                <p role="alert" className="text-sm text-vf-danger">
                  {groupsError}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {REVIEW_GROUPS_ORDER.map((key) => (
                      <div key={key} className="flex flex-col gap-1.5 rounded-vf-md border border-vf-paper-border p-3">
                        <p className="font-mono text-xl font-semibold tabular-nums text-vf-ink">{groups[key].length}</p>
                        <Badge tone={REVIEW_GROUP_TONE[key]}>{REVIEW_GROUP_LABELS[key]}</Badge>
                      </div>
                    ))}
                  </div>
                  {transactionsHasMore && (
                    <p className="text-xs text-vf-ink-faint">
                      Showing the first {transactions?.length ?? 0} transactions from this import —{" "}
                      <Link className="underline" href={transactionExplorerHref}>
                        open Transaction Explorer
                      </Link>{" "}
                      to see the rest.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Step 4 — Allocate / Match */}
            {!loadingGroups && !groupsError && (
              <div className="flex flex-col gap-3 border-t border-vf-paper-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-vf-ink">Allocate &amp; Match</h3>
                    <p className="text-xs text-vf-ink-faint">Transactions that need a decision before this statement is fully processed.</p>
                  </div>
                  <Button href={transactionExplorerHref} variant="subtle" size="sm">
                    Open Transaction Explorer
                  </Button>
                </div>
                {attentionItems.length === 0 ? (
                  <EmptyState
                    icon={<IconAlertTriangle className="h-5 w-5" />}
                    title="Nothing needs a decision."
                    description="Every transaction from this import is Matched, Allocated, or otherwise clean."
                  />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {attentionItems.slice(0, 8).map((t) => {
                      const status = computeMatchStatus(t, false, false);
                      return (
                        <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-vf-md border border-vf-paper-border p-3 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium text-vf-ink">{t.description || t.beneficiary || "—"}</p>
                              <Badge tone={status.tone}>{status.label}</Badge>
                              {t.ruleId !== null && (
                                <Badge tone="info">Matched by Banking Rule{t.rulesTriggered.length > 0 ? ` — ${t.rulesTriggered.join(", ")}` : ""}</Badge>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-vf-ink-faint">
                              {t.transactionDate ?? "No date"} · {money(t.debit || t.credit)} · {suggestedActionFor(t)}
                            </p>
                          </div>
                          <Button href={transactionExplorerHref} variant="subtle" size="sm">
                            Review
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {attentionItems.length > 8 && (
                  <p className="text-xs text-vf-ink-faint">
                    +{attentionItems.length - 8} more —{" "}
                    <Link className="underline" href={transactionExplorerHref}>
                      open Transaction Explorer
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}

            {/* Step 5 — Reconcile */}
            {!loadingGroups && !groupsError && (
              <div className="flex flex-col gap-3 border-t border-vf-paper-border pt-5">
                <div>
                  <h3 className="text-sm font-semibold text-vf-ink">Reconcile</h3>
                  <p className="text-xs text-vf-ink-faint">Prove this statement against the ledger in Cashbook &amp; Bank Reconciliation.</p>
                </div>
                {touchedAccountIds.length === 0 ? (
                  <p className="text-sm text-vf-ink-faint">No bank account could be determined for this statement yet.</p>
                ) : touchedAccountIds.length > 1 ? (
                  <p className="text-sm text-vf-ink-faint">This statement touched {touchedAccountIds.length} bank accounts — reconcile each individually in Cashbook.</p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-vf-md border border-vf-paper-border p-3.5">
                    <div>
                      <p className="text-sm font-medium text-vf-ink">{touchedAccount?.account.accountName ?? "Bank account"}</p>
                      <p className="text-xs text-vf-ink-faint">
                        {reconciled
                          ? "Reconciled since this import."
                          : touchedAccount?.account.lastReconciliationDate
                            ? `Last reconciled ${touchedAccount.account.lastReconciliationDate} — before this import.`
                            : "Never reconciled."}
                      </p>
                    </div>
                    <Badge tone={reconciled ? "good" : "warn"}>{reconciled ? "Reconciled" : "Outstanding"}</Badge>
                  </div>
                )}
                <Button href={`/company/${companyId}/cashbook`} variant="subtle" size="sm" className="self-start">
                  Open Cashbook &amp; Reconciliation
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
