import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/ui/icons";
import { CaptureReviewWorkspace } from "@/components/financial/supplier-documents/capture-review";
import type { ReviewCapture, ReviewFinding, ReviewHeader, SupplierCandidate } from "@/components/financial/supplier-documents/review-types";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { formatDateTime } from "@/lib/format";
import { captureStage, documentKindLabel, STATUS_LABEL, STATUS_TONE } from "@/lib/supplier-documents/capture-stages";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getCaptureReview } from "@/server/services/supplier-invoice-capture-service";
import { loadCapturePermissions } from "@/server/services/supplier-document-access";
import { readExtractionSnapshot } from "@/server/supplier-invoice-capture/review-validation";

export const metadata: Metadata = {
  title: "Review supplier document — PRECISIA",
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export default async function CaptureReviewPage({ params }: { params: Promise<{ companyId: string; captureId: string }> }) {
  const { companyId, captureId } = await params;
  const id = Number(captureId);
  // Preview Mode stores no supplier documents, so there is nothing to open.
  if (!isSupabaseConfigured() || !Number.isInteger(id)) notFound();

  const can = await loadCapturePermissions(companyId);
  const backLink = (
    <BackLink href={`/company/${companyId}/supplier-documents/invoice-capture`} label="Back to Invoice Capture" />
  );
  if (!can.view) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {backLink}
        <Card>
          <EmptyState
            icon={<IconShieldCheck className="h-6 w-6" />}
            title="You do not have access to supplier invoices"
            description="Viewing captured supplier documents needs the Purchasing View permission. Ask an administrator if you need it."
          />
        </Card>
      </div>
    );
  }

  const [review, suppliers, vatTreatments, chartOfAccounts] = await Promise.all([
    getCaptureReview(companyId, id),
    listSuppliers(companyId),
    listVatTreatments(companyId),
    listChartOfAccounts(companyId),
  ]);
  if (!review) notFound();
  const { capture, lines, events, bill, document } = review;

  const snapshot = readExtractionSnapshot(capture.extraction_snapshot);
  const snapshotHeader = snapshot?.header as Record<string, unknown> | undefined;
  const header: ReviewHeader = {
    documentType: capture.document_type,
    invoiceNumber: capture.invoice_number,
    invoiceDate: capture.invoice_date,
    dueDate: capture.due_date,
    orderReference: capture.order_reference,
    currencyCode: capture.currency_code,
    subtotal: num(capture.subtotal),
    discountTotal: num(capture.discount_total),
    vatAmount: num(capture.vat_amount),
    total: num(capture.total),
  };

  const data: ReviewCapture = {
    id: capture.id,
    status: capture.status,
    stage: captureStage(capture.status, bill?.postingStatus ?? null),
    manualEntry: capture.manual_entry,
    header,
    extracted: snapshotHeader
      ? {
          documentType: str(snapshotHeader.documentType),
          invoiceNumber: str(snapshotHeader.invoiceNumber),
          invoiceDate: str(snapshotHeader.invoiceDate),
          dueDate: str(snapshotHeader.dueDate),
          orderReference: str(snapshotHeader.orderReference),
          currencyCode: str(snapshotHeader.currencyCode),
          subtotal: num(snapshotHeader.subtotal),
          discountTotal: num(snapshotHeader.discountTotal),
          vatAmount: num(snapshotHeader.vatAmount),
          total: num(snapshotHeader.total),
          supplierName: str(snapshotHeader.supplierName),
        }
      : null,
    extractedLines: snapshot
      ? snapshot.lines.map((l) => ({
          description: l.description ?? null,
          quantity: num(l.quantity),
          unitPrice: num(l.unitPrice),
          vatAmount: num(l.vatAmount),
          lineTotal: num(l.lineTotal),
        }))
      : null,
    supplierNameExtracted: capture.supplier_name_extracted,
    supplierVatNumberExtracted: capture.supplier_vat_number_extracted,
    supplierRegistrationNumberExtracted: capture.supplier_registration_number_extracted,
    supplierId: capture.supplier_id,
    supplierMatchTier: capture.supplier_match_tier,
    supplierCandidates: (Array.isArray(capture.supplier_candidates) ? capture.supplier_candidates : [])
      .map((c: Record<string, unknown>): SupplierCandidate => ({
        supplierId: Number(c.supplierId),
        name: String(c.supplierName ?? ""),
        reason: typeof c.reason === "string" ? c.reason : undefined,
      }))
      .filter((c) => Number.isInteger(c.supplierId)),
    validationStatus: capture.validation_status,
    validationFindings: (Array.isArray(capture.validation_findings) ? capture.validation_findings : []) as ReviewFinding[],
    validatedAt: capture.validated_at,
    duplicateStatus: capture.duplicate_status,
    duplicateReason: capture.duplicate_reason,
    duplicateOfCaptureId: capture.duplicate_of_capture_id,
    duplicateOfBillId: capture.duplicate_of_bill_id,
    lastErrorMessage: capture.last_error_message,
    modelConfidence: capture.model_confidence,
    receivedAt: capture.created_at,
    uploadedBy: capture.uploaded_by,
    convertedAt: capture.converted_at,
    convertedBy: capture.converted_by,
    lines: lines.map((l) => ({
      lineOrder: l.line_order,
      description: l.description ?? "",
      supplierSku: l.supplier_sku,
      quantity: num(l.quantity),
      uom: l.uom,
      packDescription: l.pack_description,
      unitPrice: num(l.unit_price),
      discount: num(l.discount),
      vatRatePercent: num(l.vat_rate_percent),
      vatAmount: num(l.vat_amount),
      lineTotal: num(l.line_total),
      glAccountSuggested: l.gl_account_suggested,
      glAccountSource: l.gl_account_source,
      vatCodeSuggested: l.vat_code_suggested,
      vatCodeSource: l.vat_code_source,
      glAccountConfirmed: l.gl_account_confirmed,
      vatCodeConfirmed: l.vat_code_confirmed,
      isExcluded: l.is_excluded,
    })),
    events: events.map((e) => ({ id: e.id, eventType: e.event_type, detail: e.detail ?? {}, performedBy: e.performed_by, occurredAt: e.occurred_at })),
    document,
    bill,
  };

  const supplierName = suppliers.find((s) => s.id === capture.supplier_id)?.name ?? capture.supplier_name_extracted;
  const kind = documentKindLabel(capture.document_type);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {backLink}
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div className="min-w-0">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Supplier {kind.toLowerCase()}</span>
            <h1 className="mt-2 text-3xl font-medium break-words text-vf-on-dark sm:text-4xl">
              {supplierName ?? document?.filename ?? `Document ${capture.id}`}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-vf-on-dark-faint">
              <Badge tone={STATUS_TONE[capture.status]}>{STATUS_LABEL[capture.status]}</Badge>
              {kind === "Credit note" && <Badge tone="info">Credit note — reduces what you owe</Badge>}
              {capture.manual_entry && <Badge className="bg-white/12">Entered by hand</Badge>}
              {capture.invoice_number && <span className="font-mono">{capture.invoice_number}</span>}
              <span>Received {formatDateTime(capture.created_at)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <CaptureReviewWorkspace
        companyId={companyId}
        capture={data}
        can={can}
        suppliers={suppliers.filter((s) => s.status !== "Inactive" || s.id === capture.supplier_id)}
        vatTreatments={vatTreatments}
        chartOfAccounts={chartOfAccounts}
      />
    </div>
  );
}
