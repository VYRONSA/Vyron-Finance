/**
 * The documents a server-generated PDF can contain, built entirely on the
 * server. Every value is read through the SAME services the app's own
 * routes use, under the signed-in user's own Supabase session — so RLS
 * and tenant isolation apply exactly as they do on screen; nothing here
 * uses a service-role client. The markup is the same hook-free document
 * body the in-app preview renders (`components/documents/print/*`,
 * `ReportDocument`), so the PDF is exactly what the accountant sees.
 */
import { DocumentBrandingBlock } from "@/components/documents/print/branding-block";
import { chooseCustomerAddress, formatCustomerAddress } from "@/components/documents/print/customer-address";
import { INVOICE_DOCUMENT_TITLE, InvoiceDocumentBody } from "@/components/documents/print/invoice-body";
import { StatementDocumentBody } from "@/components/documents/print/statement-body";
import { BusinessDocumentBody } from "@/components/documents/print/business-document-body";
import { ReportDocument } from "@/components/financial/reporting/report-document";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { getCompanyLogoDataUri } from "@/server/services/company-branding-service";
import { getCustomer, listCustomerAddresses } from "@/server/services/customer-service";
import { getSalesInvoice } from "@/server/services/sales-invoice-service";
import { getCustomerStatement } from "@/server/services/customer-matching-service";
import { loadLetterhead, type Letterhead } from "@/server/report-centre/letterhead";
import { reportHomeMap } from "@/server/report-centre/registry";
import type { BusinessDocument } from "@/server/report-centre/documents";
import type { ReportResult } from "@/server/report-centre/types";
import { renderPrintHtml } from "./print-html";

/** The company logo inline (data: URI): the PDF page loads nothing from the
 * network, not even a signed Storage URL. No logo → no logo area. */
async function logoDataUri(companyId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  return getCompanyLogoDataUri(companyId).catch(() => null);
}

async function customerAddressLine(companyId: string, customerId: number): Promise<string | null> {
  const addresses = await listCustomerAddresses(companyId, customerId).catch(() => []);
  return formatCustomerAddress(chooseCustomerAddress(addresses));
}

async function pdfLetterhead(companyId: string): Promise<Letterhead> {
  const [letterhead, logo] = await Promise.all([loadLetterhead(companyId), logoDataUri(companyId)]);
  return { ...letterhead, logoUrl: logo };
}

export async function invoicePdfHtml(companyId: string, invoiceId: number): Promise<string | null> {
  const invoice = await getSalesInvoice(companyId, invoiceId);
  if (!invoice) return null;
  const [customer, addressLine, company, logo] = await Promise.all([
    getCustomer(companyId, invoice.customerId),
    customerAddressLine(companyId, invoice.customerId),
    getCompany(companyId),
    logoDataUri(companyId),
  ]);
  return renderPrintHtml(
    <InvoiceDocumentBody
      invoice={invoice}
      customer={customer ?? undefined}
      addressLine={addressLine}
      letterhead={<DocumentBrandingBlock company={company} logoSrc={logo} />}
    />,
    `${INVOICE_DOCUMENT_TITLE[invoice.documentType]} ${invoice.invoiceNumber}`,
  );
}

export async function statementPdfHtml(companyId: string, customerId: number): Promise<string | null> {
  const customer = await getCustomer(companyId, customerId);
  if (!customer) return null;
  const [entries, addressLine, company, logo] = await Promise.all([
    getCustomerStatement(companyId, customerId),
    customerAddressLine(companyId, customerId),
    getCompany(companyId),
    logoDataUri(companyId),
  ]);
  return renderPrintHtml(
    <StatementDocumentBody
      customer={{ id: customer.id, name: customer.name, vatNumber: customer.vatNumber, registrationNumber: customer.registrationNumber }}
      entries={entries}
      addressLine={addressLine}
      statementDate={new Date().toISOString().slice(0, 10)}
      letterhead={<DocumentBrandingBlock company={company} logoSrc={logo} />}
    />,
    `Statement — ${customer.name}`,
  );
}

/** `result` is the report the caller already ran with the user's filters. */
export async function reportPdfHtml(companyId: string, result: ReportResult): Promise<string> {
  return renderPrintHtml(
    <ReportDocument result={result} letterhead={await pdfLetterhead(companyId)} companyId={companyId} reportHome={reportHomeMap()} />,
    result.title,
  );
}

export async function businessDocumentPdfHtml(companyId: string, document: BusinessDocument): Promise<string> {
  return renderPrintHtml(<BusinessDocumentBody document={document} letterhead={await pdfLetterhead(companyId)} />, `${document.title} ${document.number}`);
}
