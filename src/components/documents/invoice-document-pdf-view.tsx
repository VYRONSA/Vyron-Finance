"use client";

import { InvoiceDocument } from "./invoice-document";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice } from "@/server/sales/types";

/**
 * Phase 24A — the ONLY new component this phase adds for invoices. A
 * thin, unmodified-`InvoiceDocument` wrapper whose sole job is supplying
 * the required `onClose` callback (a Server Component page can't pass a
 * function prop directly) and `open={true}`. No layout, no styling, no
 * data logic of its own — `InvoiceDocument` itself is completely
 * unchanged, so this page renders IDENTICALLY to the existing in-app
 * print preview, which is exactly what makes it safe to capture with
 * `page.pdf()` (see `pdf-generation-service.ts`).
 */
export function InvoiceDocumentPdfView({ companyId, invoice, customer }: { companyId: string; invoice: SalesInvoice; customer: Customer | undefined }) {
  return <InvoiceDocument companyId={companyId} invoice={invoice} customer={customer} open onClose={() => {}} />;
}
