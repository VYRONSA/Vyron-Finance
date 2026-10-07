"use client";

/**
 * SD-2 — reviewing one supplier document: the original on one side, what
 * was read (and what the reviewer has corrected) on the other, and the next
 * step for this document.
 *
 * Every action goes through the existing capture API (SD-1). Controls are
 * offered from the user's own Purchasing permissions and the document's
 * state; the server and the database enforce both again, and any refusal
 * (including an approval limit) is shown as it is returned.
 */
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmActionRow, useConfirmTarget } from "@/components/ui/confirm-action";
import { FIELD_BASE } from "@/components/ui/input";
import { IconAlertTriangle, IconCopy, IconRefresh } from "@/components/ui/icons";
import { supplierOptions } from "@/lib/account-picker-options";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { billStatusLabel, documentKindLabel, isCreditNote, type CapturePermissions } from "@/lib/supplier-documents/capture-stages";
import { conversionBlockers, eventLabel, eventSummary, type HeaderValues, type lineChanges } from "@/lib/supplier-documents/review-logic";
import type { Supplier } from "@/server/accounting/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import { CaptureHeaderForm } from "./capture-header-form";
import { CaptureLinesEditor } from "./capture-lines-editor";
import { OriginalDocumentViewer } from "./original-document-viewer";
import type { ReviewCapture } from "./review-types";

const TIER_LABEL: Record<string, string> = {
  vat: "matched on VAT number",
  registration: "matched on registration number",
  "supplier-code": "matched on supplier code",
  "exact-name": "matched on name",
  "normalised-name": "matched on name",
  learned: "matched from earlier documents",
  manual: "confirmed by a reviewer",
};

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

export function CaptureReviewWorkspace({
  companyId,
  capture,
  can,
  suppliers,
  vatTreatments,
  chartOfAccounts,
}: {
  companyId: string;
  capture: ReviewCapture;
  can: CapturePermissions;
  suppliers: Supplier[];
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirm = useConfirmTarget<"approve" | "reject">();
  const [supplierChoice, setSupplierChoice] = useState<number | null>(capture.supplierId);

  const api = `/api/companies/${companyId}/purchasing/invoice-capture/${capture.id}`;
  const credit = isCreditNote(capture.header.documentType);
  const kind = documentKindLabel(capture.header.documentType).toLowerCase();
  const editableState = capture.status === "NeedsReview" || capture.status === "ManualEntry";
  const editable = can.edit && editableState;

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

  const blockers = conversionBlockers({
    status: capture.status,
    documentType: capture.header.documentType,
    supplierId: capture.supplierId,
    invoiceNumber: capture.header.invoiceNumber,
    invoiceDate: capture.header.invoiceDate,
    validationStatus: capture.validationStatus,
    duplicateStatus: capture.duplicateStatus,
    duplicateReason: capture.duplicateReason,
    lines: capture.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      glAccount: l.glAccountConfirmed ?? l.glAccountSuggested,
      vatCode: l.vatCodeConfirmed ?? l.vatCodeSuggested,
      isExcluded: l.isExcluded,
    })),
  });

  const blocking = capture.validationFindings.filter((f) => f.severity === "blocking");
  const toReview = capture.validationFindings.filter((f) => f.severity !== "blocking");
  const supplierName = suppliers.find((s) => s.id === capture.supplierId)?.name ?? null;
  const base = `/company/${companyId}/supplier-documents/invoice-capture`;

  // ---------------------------------------------------------------- next step
  function nextStep(): { title: string; description: ReactNode; actions: ReactNode } {
    const reject = can.reject && !["Converted", "Cancelled", "Extracting"].includes(capture.status) && (
      <Button variant="subtle" size="sm" disabled={busy} onClick={() => confirm.request("reject")}>
        Reject
      </Button>
    );
    switch (capture.status) {
      case "Uploaded":
      case "Queued":
        return {
          title: "Waiting to be read",
          description: "Automatic reading is not switched on, so this document will not be read for you. Enter it by hand from the original.",
          actions: (
            <>
              {can.edit && (
                <Button size="sm" disabled={busy} onClick={() => void act({ action: "manual-entry" }, "You can now enter this document by hand.")}>
                  Enter by hand
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "Failed":
        return {
          title: "This document could not be read",
          description: capture.lastErrorMessage ?? "Enter it by hand from the original.",
          actions: (
            <>
              {can.edit && (
                <Button size="sm" disabled={busy} onClick={() => void act({ action: "manual-entry" }, "You can now enter this document by hand.")}>
                  Enter by hand
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "Extracting":
        return { title: "Being read", description: "This document is being read. Refresh in a moment.", actions: null };
      case "Duplicate":
        return {
          title: "Duplicate — not captured",
          description: capture.duplicateReason || "This file has already been captured.",
          actions: reject,
        };
      case "ManualEntry":
        return {
          title: "Entering by hand",
          description: "Fill in the supplier, details and lines from the original, then submit it for review. It is checked like any other document.",
          actions: (
            <>
              {can.edit && (
                <Button size="sm" disabled={busy} onClick={() => void act({ action: "submit-for-review" }, "Submitted for review and checked.")}>
                  Submit for review
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "NeedsReview":
        return {
          title: blockers.length === 0 ? `Ready to approve` : "Needs review",
          description:
            blockers.length === 0
              ? `Approving creates a draft ${credit ? "supplier credit note" : "bill"}. It is posted only through the purchasing workflow, and your approval limit is checked against its amount.`
              : "Resolve the points below before this can be approved.",
          actions: (
            <>
              {can.approve && (
                <Button size="sm" disabled={busy || blockers.length > 0} onClick={() => confirm.request("approve")}>
                  Approve — create draft {credit ? "credit note" : "bill"}
                </Button>
              )}
              {can.edit && capture.validationStatus === "Pending" && (
                <Button variant="subtle" size="sm" disabled={busy} onClick={() => void act({ action: "revalidate" }, "Checked again.")}>
                  <IconRefresh className="h-4 w-4" /> Validate again
                </Button>
              )}
              {reject}
            </>
          ),
        };
      case "Converted":
        return {
          title: capture.bill?.postingStatus === "Posted" ? "Posted" : "Approved",
          description: (
            <>
              Approved{capture.convertedBy ? ` by ${capture.convertedBy}` : ""}
              {capture.convertedAt ? ` on ${formatDateTime(capture.convertedAt)}` : ""}. It became draft{" "}
              {credit ? "credit note" : "bill"} #{capture.bill?.id ?? "—"}
              {capture.bill ? ` — ${billStatusLabel(capture.bill.postingStatus).toLowerCase()}` : ""}.
            </>
          ),
          actions: (
            <Button href={`/company/${companyId}/purchasing?tab=bills`} variant="subtle" size="sm">
              Open in Purchasing
            </Button>
          ),
        };
      case "Cancelled":
        return { title: "Rejected", description: "This document was rejected. The original and its history are kept.", actions: null };
    }
  }
  const step = nextStep();

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="min-w-0">
        <OriginalDocumentViewer companyId={companyId} captureId={capture.id} document={capture.document} />
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        {/* Next step */}
        <Card className="min-w-0">
          <CardContent className="flex flex-col gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Next step</p>
              <h2 className="mt-1 text-lg font-semibold text-vf-ink">{step.title}</h2>
              <p className="mt-1 text-sm text-vf-ink-soft">{step.description}</p>
            </div>
            {capture.status === "NeedsReview" && blockers.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-vf-ink-soft">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {step.actions && <div className="flex flex-wrap items-center gap-2">{step.actions}</div>}
            {!can.edit && !can.approve && !can.reject && capture.status !== "Converted" && capture.status !== "Cancelled" && (
              <p className="text-xs text-vf-ink-faint">You can view this document. Reviewing it needs Purchasing Edit, Reject or Approve.</p>
            )}
            {confirm.isConfirming("approve") && (
              <ConfirmActionRow
                layout="panel"
                message={`Create a draft ${credit ? "credit note" : "bill"} for ${supplierName ?? "this supplier"} (${capture.header.invoiceNumber ?? "no number"})?`}
                itemsPreview={
                  <p className="text-xs">
                    Nothing is posted. The draft goes through the purchasing workflow, and your approval limit is checked against its amount
                    {capture.header.total !== null ? ` (${formatAmount(Math.abs(capture.header.total))} on the document)` : ""}.
                  </p>
                }
                confirmLabel={`Create draft ${credit ? "credit note" : "bill"}`}
                confirmingLabel="Creating…"
                loading={busy}
                error={error}
                onConfirm={() => void act({ action: "convert" }, `Approved. A draft ${credit ? "credit note" : "bill"} was created.`)}
                onCancel={confirm.cancel}
              />
            )}
            {confirm.isConfirming("reject") && (
              <ConfirmActionRow
                layout="panel"
                tone="danger"
                message={`Reject this ${kind}?`}
                itemsPreview={<p className="text-xs">It is not deleted: the original document and its history are kept.</p>}
                confirmLabel="Reject"
                confirmingLabel="Rejecting…"
                loading={busy}
                error={error}
                onConfirm={() => void act({ action: "cancel" }, "Rejected.")}
                onCancel={confirm.cancel}
              />
            )}
          </CardContent>
        </Card>

        {notice && (
          <p role="status" className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink-soft">
            {notice}
          </p>
        )}
        {error && !confirm.target && (
          <p role="alert" className="rounded-vf-sm border border-vf-danger/40 px-3 py-2 text-sm text-vf-danger">
            {error}
          </p>
        )}

        {/* Credit note */}
        {credit && (
          <Panel
            tone="info"
            title="This is a supplier credit note"
            description="It reduces what you owe this supplier. Approving it creates a draft supplier credit note, never a bill, and the purchasing workflow posts it as a reduction."
          />
        )}

        {/* Duplicate */}
        {capture.duplicateStatus !== "None" && capture.status !== "Converted" && capture.status !== "Cancelled" && (
          <Panel
            tone={capture.duplicateStatus === "Blocked" ? "danger" : "warn"}
            title={capture.duplicateStatus === "Blocked" ? "Duplicate — this cannot be approved" : "Possible duplicate — check before approving"}
            description={capture.duplicateReason || undefined}
          >
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <IconCopy className="h-4 w-4 text-vf-ink-faint" />
              {capture.duplicateOfCaptureId !== null && (
                <a className="font-medium text-vf-red-600 hover:underline" href={`${base}/${capture.duplicateOfCaptureId}`}>
                  Open the other document
                </a>
              )}
              {capture.duplicateOfBillId !== null && (
                <a className="font-medium text-vf-red-600 hover:underline" href={`/company/${companyId}/purchasing?tab=bills`}>
                  Bill #{capture.duplicateOfBillId} in Purchasing
                </a>
              )}
            </div>
          </Panel>
        )}

        {/* Validation */}
        {(blocking.length > 0 || toReview.length > 0 || capture.validationStatus === "Pending") && capture.status !== "Converted" && capture.status !== "Cancelled" && (
          <Panel
            tone={blocking.length > 0 ? "danger" : "warn"}
            title={
              capture.validationStatus === "Pending"
                ? "Not checked since the last change"
                : blocking.length > 0
                  ? "The figures could not be read reliably"
                  : "Check these against the original"
            }
            description={
              capture.validationStatus === "Pending"
                ? "Corrections are checked automatically. If this stays here, use Validate again."
                : capture.validatedAt
                  ? `Checked ${formatDateTime(capture.validatedAt)}.`
                  : undefined
            }
          >
            {[...blocking, ...toReview].length > 0 && (
              <ul className="flex flex-col gap-2">
                {[...blocking, ...toReview].map((f, i) => (
                  <li key={`${f.code}-${i}`} className="flex gap-2 text-sm text-vf-ink-soft">
                    <IconAlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${f.severity === "blocking" ? "text-vf-danger" : "text-vf-warning"}`} />
                    <span>
                      {f.message}
                      {f.severity === "blocking" && <Badge tone="danger" className="ml-2">Must fix</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* Supplier */}
        <Panel
          title="Supplier"
          description={
            capture.supplierId !== null
              ? `${supplierName ?? "Supplier"} — ${TIER_LABEL[capture.supplierMatchTier ?? ""] ?? "selected"}.`
              : "Not confirmed yet. Choose the supplier this document is from. A supplier is never created automatically."
          }
        >
          {(capture.supplierNameExtracted || capture.supplierVatNumberExtracted) && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              {capture.supplierNameExtracted && (
                <>
                  <dt className="text-vf-ink-faint">The document says</dt>
                  <dd className="text-vf-ink">{capture.supplierNameExtracted}</dd>
                </>
              )}
              {capture.supplierVatNumberExtracted && (
                <>
                  <dt className="text-vf-ink-faint">VAT number</dt>
                  <dd className="font-mono text-vf-ink">{capture.supplierVatNumberExtracted}</dd>
                </>
              )}
              {capture.supplierRegistrationNumberExtracted && (
                <>
                  <dt className="text-vf-ink-faint">Registration number</dt>
                  <dd className="font-mono text-vf-ink">{capture.supplierRegistrationNumberExtracted}</dd>
                </>
              )}
            </dl>
          )}
          {editable && (
            <>
              {capture.supplierId === null && capture.supplierCandidates.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-vf-ink-faint">Did you mean</span>
                  {capture.supplierCandidates.map((c) => (
                    <Button key={c.supplierId} variant="subtle" size="sm" disabled={busy} title={c.reason} onClick={() => setSupplierChoice(c.supplierId)}>
                      {c.name}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Combobox
                    aria-label="Supplier"
                    value={supplierChoice}
                    options={supplierOptions(suppliers)}
                    inputClassName={FIELD_BASE}
                    placeholder="Choose a supplier"
                    onCommit={(value) => setSupplierChoice(value)}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={busy || supplierChoice === null || supplierChoice === capture.supplierId}
                  onClick={() => void act({ action: "correct-header", header: { supplierId: supplierChoice } }, "Supplier confirmed.")}
                >
                  Confirm supplier
                </Button>
              </div>
            </>
          )}
        </Panel>

        <CaptureHeaderForm
          header={capture.header as HeaderValues}
          extracted={capture.extracted}
          manualEntry={capture.manualEntry}
          editable={editable}
          busy={busy}
          onSave={(changes) => act({ action: "correct-header", header: changes }, "Details saved and checked again.")}
        />

        <CaptureLinesEditor
          lines={capture.lines}
          documentTotals={{ subtotal: capture.header.subtotal, vatAmount: capture.header.vatAmount, total: capture.header.total }}
          creditNote={credit}
          editable={editable}
          busy={busy}
          vatTreatments={vatTreatments}
          chartOfAccounts={chartOfAccounts}
          onSave={(changes: ReturnType<typeof lineChanges>) =>
            act({ action: "correct-lines", lines: changes.lines, add: changes.add, remove: changes.remove }, "Lines saved and checked again.")
          }
        />

        {capture.extractedLines && capture.extractedLines.length > 0 && (
          <details className="rounded-vf-lg border border-vf-paper-border bg-vf-paper p-5 shadow-vf-paper-sm">
            <summary className="cursor-pointer text-sm font-semibold text-vf-ink">As read from the document</summary>
            <p className="mt-2 text-xs text-vf-ink-faint">
              The lines exactly as they were read, before any correction. Kept unchanged for the record.
            </p>
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {capture.extractedLines.map((l, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-vf-paper-border py-1 last:border-0">
                  <span className="min-w-0 text-vf-ink-soft">{l.description ?? "—"}</span>
                  <span className="font-mono tabular-nums text-vf-ink">
                    {l.quantity ?? "—"} × {l.unitPrice === null ? "—" : formatAmount(l.unitPrice)} = {l.lineTotal === null ? "—" : formatAmount(l.lineTotal)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* History */}
        <Panel title="History" description="Who did what, and when. This record cannot be changed.">
          {capture.events.length === 0 ? (
            <p className="text-sm text-vf-ink-faint">Nothing recorded yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {capture.events.map((e) => {
                const summary = eventSummary(e.eventType, e.detail);
                return (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-vf-paper-border pb-2 text-sm last:border-0">
                    <span className="text-vf-ink">
                      {eventLabel(e.eventType)}
                      {summary && <span className="text-vf-ink-faint"> · {summary}</span>}
                    </span>
                    <span className="text-xs text-vf-ink-faint">
                      {e.performedBy || "System"} · {formatDateTime(e.occurredAt)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="text-xs text-vf-ink-faint">
            Received {formatDate(capture.receivedAt)}
            {capture.uploadedBy ? ` from ${capture.uploadedBy}` : ""}.
          </p>
        </Panel>
      </div>
    </div>
  );
}
