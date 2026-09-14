/**
 * Phase 24B — the ONE service capable of sending a branded Invoice or
 * Customer Statement email, both funneling through the SAME existing
 * infrastructure: `generateInvoicePdf`/`generateStatementPdf` (Phase
 * 24A, unmodified) for the PDF bytes, `uploadDocument` (the existing
 * Document Platform) so the exact PDF that was emailed becomes a real,
 * durable, auditable record (not a viewing cache — see Phase 24A's own
 * "on-demand, not stored" note, which was about VIEWING; an email
 * attachment is a different concern: a fixed historical record of what
 * was actually sent), and `queueCommunication` (the existing Communication
 * Platform) for delivery, audit history, and retry — never a parallel
 * mechanism for any of these.
 *
 * The PDF is generated exactly ONCE per send — the same `Buffer`
 * `generateInvoicePdf`/`generateStatementPdf` returns is wrapped directly
 * into the `Blob` passed to `uploadDocument`; nothing re-generates or
 * re-renders it afterwards.
 */

import { getSalesInvoice } from "@/server/services/sales-invoice-service";
import { getCustomer } from "@/server/services/customer-service";
import { getCustomerStatement } from "@/server/services/customer-matching-service";
import { getCompany } from "@/server/services/company-service";
import { getCompanyLogoDataUri } from "@/server/services/company-branding-service";
import { generateInvoicePdf, generateReportPdf, generateStatementPdf } from "@/server/pdf/pdf-generation-service";
import { runReport } from "@/server/report-centre/run";
import { reportSourceForCompany } from "@/server/report-centre/source-for-company";
import { invoicePdfFilename, statementPdfFilename } from "@/server/pdf/pdf-filename";
import { uploadDocument } from "@/server/services/document-service";
import { queueCommunication } from "@/server/services/communication-service";
import { buildInvoiceEmailHtml, buildStatementEmailHtml } from "@/server/communications/document-email-template";
import { listCustomerContacts } from "@/server/repositories/customer-repository";
import type { CommunicationRecord } from "@/server/communications/types";
import type { SalesInvoiceDocumentType } from "@/server/sales/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const DOCUMENT_LABEL: Record<SalesInvoiceDocumentType, string> = {
  Invoice: "Tax Invoice",
  "Credit Note": "Credit Note",
  "Debit Note": "Debit Note",
};

/** The authoritative recipient — a `Customer` record has no email field
 * of its own (confirmed by inspection: email lives on `CustomerContact`,
 * a separate one-to-many entity). Prefers the primary contact, then any
 * contact with a real email, matching `useCustomerAddress`'s own
 * "default, then first available" precedent for customer sub-records.
 * Returns `null` — never a fabricated address — when the customer
 * genuinely has none on file. */
async function resolveCustomerEmail(customerId: number): Promise<string | null> {
  const contacts = await listCustomerContacts(customerId);
  const chosen = contacts.find((c) => c.isPrimary && c.email) ?? contacts.find((c) => c.email);
  return chosen?.email ?? null;
}

export async function sendInvoiceEmail(request: Request, companyId: string, invoiceId: number, performedBy: string): Promise<CommunicationRecord> {
  const invoice = await getSalesInvoice(companyId, invoiceId);
  if (!invoice) throw new NotFoundError("Sales invoice not found.");

  const customer = await getCustomer(companyId, invoice.customerId);
  if (!customer) throw new NotFoundError("Customer not found.");

  const recipientEmail = await resolveCustomerEmail(customer.id);
  if (!recipientEmail) throw new ValidationError("This customer has no email address on file. Add one under Customer Contacts before sending.");

  const company = await getCompany(companyId);
  if (!company) throw new NotFoundError("Company not found.");

  const [pdfBuffer, logoDataUri] = await Promise.all([generateInvoicePdf(companyId, invoice.id), getCompanyLogoDataUri(companyId)]);

  const documentLabel = DOCUMENT_LABEL[invoice.documentType];
  const filename = invoicePdfFilename(invoice);
  const document = await uploadDocument(
    {
      companyId,
      entityType: "SalesInvoice",
      entityId: invoice.id,
      category: "Invoice",
      filename,
      mimeType: "application/pdf",
      file: new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
      retentionUntil: null,
      uploadedBy: performedBy,
    },
    null,
  );

  const html = buildInvoiceEmailHtml({
    company,
    branding: { logoDataUri },
    customerName: customer.name,
    documentLabel,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    total: invoice.total,
    outstanding: invoice.outstanding,
  });

  return queueCommunication(companyId, {
    module: "Sales",
    businessObjectType: "SalesInvoice",
    businessObjectId: invoice.id,
    channel: "Email",
    recipients: [{ type: "Customer", id: customer.id, name: customer.name, address: recipientEmail }],
    subject: `${documentLabel} ${invoice.invoiceNumber} from ${company.tradingName || company.name}`,
    body: html,
    documentIds: [document.id],
    createdBy: performedBy,
  });
}

export async function sendStatementEmail(request: Request, companyId: string, customerId: number, performedBy: string): Promise<CommunicationRecord> {
  const customer = await getCustomer(companyId, customerId);
  if (!customer) throw new NotFoundError("Customer not found.");

  const recipientEmail = await resolveCustomerEmail(customer.id);
  if (!recipientEmail) throw new ValidationError("This customer has no email address on file. Add one under Customer Contacts before sending.");

  const company = await getCompany(companyId);
  if (!company) throw new NotFoundError("Company not found.");

  const [entries, pdfBuffer, logoDataUri] = await Promise.all([
    getCustomerStatement(companyId, customer.id),
    generateStatementPdf(companyId, customer.id),
    getCompanyLogoDataUri(companyId),
  ]);
  const closingBalance = entries.length > 0 ? entries[entries.length - 1]!.balance : 0;
  const asOfDate = new Date().toISOString().slice(0, 10);

  const filename = statementPdfFilename(customer.name, asOfDate);
  const document = await uploadDocument(
    {
      companyId,
      entityType: "Customer",
      entityId: customer.id,
      category: "Statement",
      filename,
      mimeType: "application/pdf",
      file: new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
      retentionUntil: null,
      uploadedBy: performedBy,
    },
    null,
  );

  const html = buildStatementEmailHtml({ company, branding: { logoDataUri }, customerName: customer.name, asOfDate, closingBalance });

  return queueCommunication(companyId, {
    module: "Sales",
    businessObjectType: "Customer",
    businessObjectId: customer.id,
    channel: "Email",
    recipients: [{ type: "Customer", id: customer.id, name: customer.name, address: recipientEmail }],
    subject: `Statement of Account from ${company.tradingName || company.name}`,
    body: html,
    documentIds: [document.id],
    createdBy: performedBy,
  });
}

/** Reporting Centre — email the Customer Statement exactly as the user
 * is viewing it (the Reporting Centre statement: opening balance, every
 * posted document, receipt and bank-posted receipt in the period, and
 * aging), as a PDF rendered from the same report. Same recipient rules,
 * document archive and communication queue as `sendStatementEmail`. */
export async function sendReportStatementEmail(
  request: Request,
  companyId: string,
  customerId: number,
  period: { dateFrom?: string; dateTo?: string },
  performedBy: string,
): Promise<CommunicationRecord> {
  const customer = await getCustomer(companyId, customerId);
  if (!customer) throw new NotFoundError("Customer not found.");

  const recipientEmail = await resolveCustomerEmail(customer.id);
  if (!recipientEmail) throw new ValidationError("This customer has no email address on file. Add one under Customer Contacts before sending.");

  const company = await getCompany(companyId);
  if (!company) throw new NotFoundError("Company not found.");

  const filters = { customerId: String(customer.id), ...(period.dateFrom ? { dateFrom: period.dateFrom } : {}), ...(period.dateTo ? { dateTo: period.dateTo } : {}) };
  const { result, filters: resolved } = await runReport(reportSourceForCompany(companyId), "customer-statement", filters);
  const amountDue = result.summary.find((s) => s.label === "Amount Due")?.value;
  const closingBalance = typeof amountDue === "number" ? amountDue : 0;

  const [pdfBuffer, logoDataUri] = await Promise.all([generateReportPdf(companyId, result), getCompanyLogoDataUri(companyId)]);

  const filename = statementPdfFilename(customer.name, resolved.dateTo);
  const document = await uploadDocument(
    {
      companyId,
      entityType: "Customer",
      entityId: customer.id,
      category: "Statement",
      filename,
      mimeType: "application/pdf",
      file: new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
      retentionUntil: null,
      uploadedBy: performedBy,
    },
    null,
  );

  const html = buildStatementEmailHtml({ company, branding: { logoDataUri }, customerName: customer.name, asOfDate: resolved.dateTo, closingBalance });

  return queueCommunication(companyId, {
    module: "Sales",
    businessObjectType: "Customer",
    businessObjectId: customer.id,
    channel: "Email",
    recipients: [{ type: "Customer", id: customer.id, name: customer.name, address: recipientEmail }],
    subject: `Statement of Account from ${company.tradingName || company.name}`,
    body: html,
    documentIds: [document.id],
    createdBy: performedBy,
  });
}
