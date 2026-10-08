"use client";

/**
 * SD-3E — one supplier statement, end to end: review it against the original,
 * correct it, confirm whose statement it is, mark it ready, reconcile it, and
 * explain what does not agree.
 *
 * Every action goes through the SD-3C/SD-3D API, which checks the user's
 * Purchasing permission before anything else; the database enforces the
 * same rules again. Controls are offered from the user's permissions and the
 * statement's state only so nobody is shown a button that would be refused.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { FIELD_BASE, Input } from "@/components/ui/input";
import { IconAlertTriangle, IconRefresh } from "@/components/ui/icons";
import { useUrlParam } from "@/hooks/use-url-param";
import { supplierOptions } from "@/lib/account-picker-options";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CapturePermissions } from "@/lib/supplier-documents/capture-stages";
import { EVENT_LABEL, MATCH_TIER_LABEL, readinessBlockers, statementEventSummary } from "@/lib/supplier-documents/statement-stages";
import type { Supplier } from "@/server/accounting/types";
import { OriginalDocumentViewer, type ViewerDocument } from "./original-document-viewer";
import { StatementHeaderForm } from "./statement-header-form";
import { StatementLinesEditor } from "./statement-lines-editor";
import { StatementReconciliation } from "./statement-reconciliation";
import type { ReconRunDetailView, ReconRunSummaryView, ResolutionView, StatementEventView, StatementLineView, StatementView } from "./statement-types";

function Panel({ title, description, children, tone = "paper" }: { title: string; description?: ReactNode; children?: ReactNode; tone?: "paper" | "danger" | "warn" | "info" }) {
  const border = tone === "danger" ? "border-vf-danger/40" : tone === "warn" ? "border-vf-warning/40" : tone === "info" ? "border-vf-info/40" : "";
  return (
    <Card className={border}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children && <CardContent className="flex flex-col gap-3">{children}</CardContent>}
    </Card>
  );
}

const VIEWS = [
  { key: "review", label: "Review" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "history", label: "History" },
] as const;

export function StatementReviewWorkspace({
  companyId,
  statement,
  lines,
  events,
  document,
  suppliers,
  can,
  runs,
  selectedRun,
  latestRunId,
  resolutions,
  stale,
}: {
  companyId: string;
  statement: StatementView;
  lines: StatementLineView[];
  events: StatementEventView[];
  document: ViewerDocument;
  suppliers: Supplier[];
  can: CapturePermissions;
  runs: ReconRunSummaryView[];
  selectedRun: ReconRunDetailView | null;
  latestRunId: number | null;
  resolutions: ResolutionView[];
  stale: boolean;
}) {
  const router = useRouter();
  const [viewParam, setView] = useUrlParam("view", statement.status === "Reconciled" ? "reconciliation" : "review");
  const view = VIEWS.some((v) => v.key === viewParam) ? viewParam : "review";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [supplierChoice, setSupplierChoice] = useState<number | null>(statement.supplierId);
  // The proposal can arrive after the page was opened (a statement opened
  // while still being read): follow the stored supplier whenever it changes —
  // adjusted during render, not in an effect.
  const [shownSupplier, setShownSupplier] = useState(statement.supplierId);
  if (shownSupplier !== statement.supplierId) {
    setShownSupplier(statement.supplierId);
    setSupplierChoice(statement.supplierId);
  }
  const [saveAccount, setSaveAccount] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const confirm = useConfirmTarget<"reject">();

  const api = `/api/companies/${companyId}/purchasing/supplier-statements/${statement.id}`;
  const editable = can.edit && (statement.status === "NeedsReview" || statement.status === "ManualEntry");
  const reading = statement.status === "Queued" || statement.status === "Processing";

  // While it is being read (after the upload), look again shortly.
  useEffect(() => {
    if (!reading) return;
    const t = setTimeout(() => router.refresh(), 3000);
    return () => clearTimeout(t);
  }, [reading, statement, router]);

  async function act(body: Record<string, unknown>, success?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(api, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That could not be done. Refresh the page and try again.");
        return false;
      }
      if (success) setNotice(success);
      confirm.cancel();
      router.refresh();
      return true;
    } catch {
      setError("That could not be done. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const unreadLines = lines.filter((l) => !l.isExcluded && l.unresolvedFields.length > 0).length;
  const blockers = readinessBlockers({
    status: statement.status,
    validationStatus: statement.validationStatus,
    supplierId: statement.supplierId,
    supplierConfirmed: statement.supplierConfirmed,
    currencySupported: statement.currencySupported,
    unreadLines,
    statementDate: statement.header.statementDate,
  });
  const supplierName = suppliers.find((s) => s.id === statement.supplierId)?.name ?? null;
  const incomplete = statement.validationFindings.filter((f) => f.severity === "incomplete");
  const toReview = statement.validationFindings.filter((f) => f.severity !== "incomplete");
  const originalUrl = `${api}/original`;

  // ------------------------------------------------------------ next step
  function nextStep(): { title: string; description: ReactNode; actions: ReactNode } {
    const reject = can.reject && !["Rejected", "Processing"].includes(statement.status) && (
      <Button variant="subtle" size="sm" disabled={busy} onClick={() => confirm.request("reject")}>
        Reject
      </Button>
    );
    switch (statement.status) {
      case "Queued":
        return {
          title: "Waiting to be read",
          description: "PDF statements are read automatically after upload. This page updates by itself. If it stays here, ask for it to be read again — or enter it by hand.",
          actions: (
            <>
              {can.edit && (
                <Button size="sm" variant="subtle" disabled={busy} onClick={() => void act({ action: "requeue" }, "Queued to be read again.")}>
                  <IconRefresh className="h-4 w-4" /> Read again
                </Button>
              )}
              {can.edit && (
                <Button size="sm" variant="subtle" disabled={busy} onClick={() => void act({ action: "start-manual-entry" }, "You can now enter this statement by hand.")}>
                  Enter by hand
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "Processing":
        return { title: "Being read", description: "This statement is being read now. This page updates by itself.", actions: null };
      case "Failed":
        return {
          title: "This statement could not be read",
          description: statement.statusReason || "Enter it by hand from the original.",
          actions: (
            <>
              {can.edit && (
                <Button size="sm" disabled={busy} onClick={() => void act({ action: "start-manual-entry" }, "You can now enter this statement by hand.")}>
                  Enter by hand
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "ManualEntry":
        return {
          title: "Entering by hand",
          description: statement.statusReason || "Enter the statement's details and lines from the original, then submit it. It is checked like any other statement.",
          actions: (
            <>
              {can.edit && (
                <Button size="sm" disabled={busy} onClick={() => void act({ action: "submit-for-review" }, "Submitted and checked.")}>
                  Submit for review
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "NeedsReview":
        return {
          title: blockers.length === 0 ? "Ready to mark ready" : "Needs review",
          description: blockers.length === 0 ? "It adds up and the supplier is confirmed. Mark it ready, then reconcile it against the supplier ledger." : "Resolve these first:",
          actions: (
            <>
              {can.edit && (
                <Button size="sm" disabled={busy || blockers.length > 0} onClick={() => void act({ action: "mark-ready" }, "Marked ready. You can reconcile it now.")}>
                  Mark ready for reconciliation
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "Ready":
        return {
          title: "Ready to reconcile",
          description: "Reconcile it against the supplier ledger. Nothing in the books is changed by reconciling.",
          actions: (
            <>
              <Button size="sm" disabled={busy} onClick={() => setView("reconciliation")}>
                Go to reconciliation
              </Button>
              {can.edit && (
                <Button size="sm" variant="subtle" disabled={busy} onClick={() => void act({ action: "reopen" }, "Reopened for review.")}>
                  Reopen for review
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "Reconciled":
        return {
          title: "Reconciled",
          description: "See the differences, explain or link them, and reconcile again. To change the statement itself, reopen it — its runs are kept.",
          actions: (
            <>
              <Button size="sm" disabled={busy} onClick={() => setView("reconciliation")}>
                Open reconciliation
              </Button>
              {can.edit && (
                <Button size="sm" variant="subtle" disabled={busy} onClick={() => void act({ action: "reopen" }, "Reopened for review.")}>
                  Reopen for review
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "Duplicate":
        return {
          title: "Duplicate — not processed",
          description: (
            <>
              {statement.statusReason || "This file was already uploaded."}{" "}
              {statement.duplicateOfStatementId !== null && (
                <a className="font-medium text-vf-red-600 hover:underline" href={`/company/${companyId}/supplier-documents/statements/${statement.duplicateOfStatementId}`}>
                  Open the other statement
                </a>
              )}
            </>
          ),
          actions: reject,
        };
      case "Rejected":
        return { title: "Rejected", description: "This statement was rejected. The original and its history are kept.", actions: null };
    }
  }
  const step = nextStep();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-vf-paper-border" role="tablist" aria-label="Statement views">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            onClick={() => {
              setNotice(null);
              setError(null);
              setView(v.key);
            }}
            className={cn(
              "shrink-0 rounded-t-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition",
              view === v.key ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
            )}
          >
            {v.label}
            {v.key === "reconciliation" && runs.length > 0 && <span className="ml-1.5 font-mono text-xs opacity-80">{runs.length}</span>}
          </button>
        ))}
      </div>

      {notice && <p role="status" className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink-soft">{notice}</p>}
      {error && !confirm.target && <p role="alert" className="rounded-vf-sm border border-vf-danger/40 px-3 py-2 text-sm text-vf-danger">{error}</p>}

      {view === "reconciliation" && (
        <StatementReconciliation
          companyId={companyId}
          statementId={statement.id}
          status={statement.status}
          canEdit={can.edit}
          runs={runs}
          selected={selectedRun}
          latestRunId={latestRunId}
          resolutions={resolutions}
          stale={stale}
        />
      )}

      {view === "history" && (
        <Panel title="History" description="Who did what, and when. This record cannot be changed. Every view and download of the original is recorded too.">
          {events.length === 0 ? (
            <p className="text-sm text-vf-ink-faint">Nothing recorded yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {events.map((e) => {
                const summary = statementEventSummary(e.type, e.detail);
                return (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-vf-paper-border pb-2 text-sm last:border-0">
                    <span className="text-vf-ink">
                      {EVENT_LABEL[e.type] ?? e.type}
                      {summary && <span className="text-vf-ink-faint"> · {summary}</span>}
                    </span>
                    <span className="text-xs text-vf-ink-faint">{e.performedBy || "System"} · {formatDateTime(e.occurredAt)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      )}

      {view === "review" && (
        <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="min-w-0">
            <OriginalDocumentViewer companyId={companyId} originalUrl={originalUrl} page={page} document={document} />
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Card className="min-w-0">
              <CardContent className="flex flex-col gap-3 p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Next step</p>
                  <h2 className="mt-1 text-lg font-semibold text-vf-ink">{step.title}</h2>
                  <p className="mt-1 text-sm text-vf-ink-soft">{step.description}</p>
                </div>
                {statement.status === "NeedsReview" && blockers.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-vf-ink-soft">
                    {blockers.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                )}
                {step.actions && <div className="flex flex-wrap items-center gap-2">{step.actions}</div>}
                {!can.edit && !can.reject && <p className="text-xs text-vf-ink-faint">You can view this statement. Reviewing it needs Purchasing Edit or Reject.</p>}
                {confirm.isConfirming("reject") && (
                  <ConfirmActionRow
                    layout="panel"
                    tone="danger"
                    message="Reject this statement?"
                    itemsPreview={
                      <div className="flex flex-col gap-2">
                        <p className="text-xs">It is not deleted: the original and its history are kept.</p>
                        <Input aria-label="Reason for rejecting" placeholder="Reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                      </div>
                    }
                    confirmLabel="Reject"
                    confirmingLabel="Rejecting…"
                    loading={busy}
                    error={error}
                    onConfirm={() => void act({ action: "reject", reason: rejectReason }, "Rejected.")}
                    onCancel={confirm.cancel}
                  />
                )}
              </CardContent>
            </Card>

            {!statement.currencySupported && (
              <Panel tone="danger" title="Unsupported currency — manual review required" description={`This statement is in ${statement.header.currencyCode}. Only the company's base currency can be reconciled; no exchange rate is ever applied.`} />
            )}

            {(statement.validationStatus !== "Pass" || statement.warnings.length > 0) && !reading && statement.status !== "Duplicate" && statement.status !== "Rejected" && (
              <Panel
                tone={incomplete.length > 0 ? "danger" : "warn"}
                title={
                  statement.validationStatus === "Pending"
                    ? "Not checked since the last change"
                    : incomplete.length > 0
                      ? "The statement does not add up yet"
                      : toReview.length > 0
                        ? "Check these against the original"
                        : "Notes from reading"
                }
                description={statement.validationStatus === "Pass" ? "The arithmetic adds up." : undefined}
              >
                {[...incomplete, ...toReview].length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {[...incomplete, ...toReview].map((f, i) => (
                      <li key={`${f.code}-${i}`} className="flex gap-2 text-sm text-vf-ink-soft">
                        <IconAlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${f.severity === "incomplete" ? "text-vf-danger" : "text-vf-warning"}`} />
                        <span>
                          {f.message}
                          {f.severity === "incomplete" && <Badge tone="danger" className="ml-2">Must fix</Badge>}
                          {f.pageNumber ? (
                            <button type="button" className="ml-2 text-xs text-vf-red-600 hover:underline" onClick={() => setPage(f.pageNumber!)}>
                              show page {f.pageNumber}
                            </button>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {statement.warnings.length > 0 && (
                  <ul className="flex flex-col gap-1 text-xs text-vf-ink-faint">
                    {statement.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
              </Panel>
            )}

            {/* Supplier */}
            <Panel
              title="Supplier"
              description={
                statement.supplierId === null
                  ? "No supplier is proposed. Choose the supplier this statement is from. A supplier is never created automatically."
                  : statement.supplierConfirmed
                    ? `${supplierName ?? "Supplier"} — confirmed by ${statement.supplierConfirmedBy ?? "a reviewer"}${statement.supplierConfirmedAt ? ` on ${formatDateTime(statement.supplierConfirmedAt)}` : ""}.`
                    : `${supplierName ?? "Supplier"} — ${MATCH_TIER_LABEL[statement.supplierMatchTier ?? ""] ?? "proposed"}. NOT confirmed: a person must confirm it before the statement can be reconciled.`
              }
              tone={statement.supplierConfirmed ? "paper" : "warn"}
            >
              {(statement.supplierNameExtracted || statement.supplierVatExtracted || statement.accountNumberExtracted) && (
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  {statement.supplierNameExtracted && (<><dt className="text-vf-ink-faint">The statement says</dt><dd className="text-vf-ink">{statement.supplierNameExtracted}</dd></>)}
                  {statement.supplierVatExtracted && (<><dt className="text-vf-ink-faint">VAT number</dt><dd className="font-mono text-vf-ink">{statement.supplierVatExtracted}</dd></>)}
                  {statement.supplierRegistrationExtracted && (<><dt className="text-vf-ink-faint">Registration number</dt><dd className="font-mono text-vf-ink">{statement.supplierRegistrationExtracted}</dd></>)}
                  {statement.accountNumberExtracted && (<><dt className="text-vf-ink-faint">Our account number</dt><dd className="font-mono text-vf-ink">{statement.accountNumberExtracted}</dd></>)}
                </dl>
              )}
              {editable && (
                <>
                  {statement.supplierCandidates.length > 0 && !statement.supplierConfirmed && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-vf-ink-faint">Possible suppliers</span>
                      {statement.supplierCandidates.map((c) => (
                        <Button key={c.supplierId} variant="subtle" size="sm" disabled={busy} title={c.reason} onClick={() => setSupplierChoice(c.supplierId)}>
                          {c.supplierName}
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                      <Combobox aria-label="Supplier" value={supplierChoice} options={supplierOptions(suppliers)} inputClassName={FIELD_BASE} placeholder="Choose a supplier" onCommit={(value) => setSupplierChoice(value)} />
                    </div>
                    <Button
                      size="sm"
                      disabled={busy || supplierChoice === null || (statement.supplierConfirmed && supplierChoice === statement.supplierId)}
                      onClick={() => void act({ action: "confirm-supplier", supplierId: supplierChoice, saveAccountNumber: saveAccount }, "Supplier confirmed.")}
                    >
                      Confirm supplier
                    </Button>
                  </div>
                  {statement.accountNumberExtracted && (
                    <label className="flex items-center gap-2 text-sm text-vf-ink-soft">
                      <input type="checkbox" checked={saveAccount} onChange={(e) => setSaveAccount(e.target.checked)} />
                      Also save our account number <span className="font-mono">{statement.accountNumberExtracted}</span> on this supplier (recorded in its audit)
                    </label>
                  )}
                  {statement.supplierConfirmed && (
                    <div>
                      <Button variant="subtle" size="sm" disabled={busy} onClick={() => void act({ action: "unconfirm-supplier" }, "Supplier confirmation removed.")}>
                        Remove confirmation
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Panel>

            <StatementHeaderForm
              header={statement.header}
              extracted={statement.extractedHeader}
              editable={editable}
              busy={busy}
              onSave={(changes) => act({ action: "correct-header", header: changes }, "Details saved and checked again.")}
            />

            <StatementLinesEditor
              lines={lines}
              editable={editable}
              busy={busy}
              onShowPage={(p) => setPage(p)}
              onSave={(changes) => act({ action: "correct-lines", lines: changes }, "Lines saved and checked again.")}
            />

            <p className="text-xs text-vf-ink-faint">
              Received {formatDate(statement.createdAt)}
              {statement.pageCount ? ` · ${statement.pageCount} page${statement.pageCount === 1 ? "" : "s"}` : ""}
              {statement.manualEntry ? " · entered by hand" : ""}
              {statement.extractionMethod === "ai" ? " · read by AI from the scan — every value was checked by the same rules as any statement; compare it with the original" : ""}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
