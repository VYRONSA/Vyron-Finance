import { notFound } from "next/navigation";
import { InvoiceDocumentPdfView } from "@/components/documents/invoice-document-pdf-view";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getSalesInvoice } from "@/server/services/sales-invoice-service";
import { getCustomer } from "@/server/services/customer-service";

/**
 * Phase 24A — an internal, non-navigable render target for
 * `pdf-generation-service.ts`'s headless-Chromium capture. Not linked
 * from anywhere in the app's own navigation, but a real, independently
 * authenticated page (reachable at this URL like any other) — so it
 * enforces the SAME `requireSession()`/`requirePermission()` checks
 * every other route does, never trusting that only the PDF service will
 * ever call it. `notFound()` on any failure (missing session, missing
 * permission, unknown invoice) rather than a distinct 401/403 page —
 * deliberately not disclosing which case applies to an unauthorized
 * viewer.
 *
 * Reuses `getSalesInvoice`/`getCustomer` — the EXACT same service calls
 * the existing in-app invoice preview's own API routes already use — no
 * new data-loading logic, no recalculated totals.
 */
export default async function InvoicePdfViewPage({ params }: { params: Promise<{ companyId: string; invoiceId: string }> }) {
  const session = await requireSession();
  if (!session.ok) notFound();

  const { companyId, invoiceId } = await params;

  const check = await requirePermission(companyId, "Sales:View");
  if (!check.ok) notFound();

  const invoice = await getSalesInvoice(companyId, Number(invoiceId));
  if (!invoice) notFound();

  const customer = await getCustomer(companyId, invoice.customerId);

  return <InvoiceDocumentPdfView companyId={companyId} invoice={invoice} customer={customer ?? undefined} />;
}
