import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { CaptureInbox } from "@/components/financial/supplier-documents/capture-inbox";
import { IconAlertTriangle, IconClock, IconFileText, IconImport, IconReceipt, IconShieldCheck } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { CAPTURE_STAGES, captureStage, type CapturePermissions, type CaptureStage, type InboxRow } from "@/lib/supplier-documents/capture-stages";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listInboxCaptures } from "@/server/services/supplier-invoice-capture-service";
import { loadCapturePermissions, NO_CAPTURE_PERMISSIONS } from "@/server/services/supplier-document-access";

export const metadata: Metadata = {
  title: "Invoice Capture — PRECISIA",
};

export default async function InvoiceCapturePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  // Preview Mode has no capture data (every API answers 501); the page
  // renders its empty workspace and says so.
  const can: CapturePermissions = previewMode ? NO_CAPTURE_PERMISSIONS : await loadCapturePermissions(companyId);
  const rows: InboxRow[] = [];
  if (!previewMode && can.view) {
    const [items, suppliers] = await Promise.all([listInboxCaptures(companyId), listSuppliers(companyId)]);
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
    for (const { capture, bill, document } of items) {
      rows.push({
        id: capture.id,
        status: capture.status,
        stage: captureStage(capture.status, bill?.postingStatus ?? null),
        documentType: capture.document_type,
        supplierName: (capture.supplier_id !== null ? supplierName.get(capture.supplier_id) : null) ?? capture.supplier_name_extracted,
        supplierConfirmed: capture.supplier_id !== null,
        invoiceNumber: capture.invoice_number,
        invoiceDate: capture.invoice_date,
        total: capture.total === null ? null : Number(capture.total),
        validationStatus: capture.validation_status,
        duplicateStatus: capture.duplicate_status,
        manualEntry: capture.manual_entry,
        filename: document?.filename ?? null,
        receivedAt: capture.created_at,
        billId: capture.bill_id,
        billPostingStatus: bill?.postingStatus ?? null,
      });
    }
  }

  const count = (stage: CaptureStage) => rows.filter((r) => r.stage === stage).length;
  const icons: Record<CaptureStage, typeof IconFileText> = {
    inbox: IconImport,
    processing: IconClock,
    "needs-review": IconAlertTriangle,
    approved: IconShieldCheck,
    posted: IconReceipt,
    rejected: IconFileText,
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Supplier Documents</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Invoice Capture</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Supplier invoices and credit notes, from the original document to a draft bill. Nothing is posted from
              here: an approved document becomes a draft, and the purchasing workflow posts it.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={CAPTURE_STAGES.map((stage) => ({
          key: stage.key,
          label: stage.label,
          value: String(count(stage.key)),
          icon: icons[stage.key],
        }))}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — supplier documents are stored per company, so there is nothing to show until Supabase is
          configured. Every action is disabled.
        </p>
      )}

      {!previewMode && !can.view ? (
        <Card>
          <EmptyState
            icon={<IconShieldCheck className="h-6 w-6" />}
            title="You do not have access to supplier invoices"
            description="Viewing captured supplier documents needs the Purchasing View permission. Ask an administrator if you need it."
          />
        </Card>
      ) : (
        <CaptureInbox companyId={companyId} rows={rows} can={can} previewMode={previewMode} />
      )}
    </div>
  );
}
