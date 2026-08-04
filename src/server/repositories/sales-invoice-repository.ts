/**
 * Repository layer for Sales Invoices (Invoice/Credit Note/Debit Note,
 * unified — same shape `ae_imported_bills` uses on the supplier side).
 * The one Sales document type that posts to the General Ledger — see
 * `sales-invoice-service.ts` for the Approve -> Posting Rule -> Journal
 * integration; this file never touches `ae_journals`/`gl_transactions`
 * itself, only stamps `journal_id` once the service layer has created one.
 */

import { createClient } from "@/lib/supabase/server";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { incrementOrderLineQuantity } from "@/server/repositories/sales-order-repository";
import { salesInvoiceFromRow, type SalesInvoiceRow } from "@/server/sales/mappers";
import type { SalesInvoice, SalesInvoiceDocumentType, SalesInvoiceStatus } from "@/server/sales/types";

const INVOICE_SELECT = "*, sales_invoice_lines(*)";
const PREFIX_BY_TYPE: Record<SalesInvoiceDocumentType, string> = { Invoice: "INV", "Credit Note": "CN", "Debit Note": "DN" };

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the full rationale; same safety bound applied here.
const LIST_CAP = 10_000;

export async function nextInvoiceNumber(companyId: string, documentType: SalesInvoiceDocumentType): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("sales_invoices")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("document_type", documentType);
  if (error) throw error;
  return `${PREFIX_BY_TYPE[documentType]}${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listSalesInvoices(companyId: string, documentType?: SalesInvoiceDocumentType): Promise<SalesInvoice[]> {
  const supabase = await createClient();
  let query = supabase.from("sales_invoices").select(INVOICE_SELECT).eq("company_id", companyId);
  if (documentType) query = query.eq("document_type", documentType);
  const { data, error } = await query.order("invoice_date", { ascending: false }).limit(LIST_CAP).returns<SalesInvoiceRow[]>();
  if (error) throw error;
  return data.map(salesInvoiceFromRow);
}

export async function listSalesInvoicesByCustomer(companyId: string, customerId: number): Promise<SalesInvoice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_invoices")
    .select(INVOICE_SELECT)
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .order("invoice_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<SalesInvoiceRow[]>();
  if (error) throw error;
  return data.map(salesInvoiceFromRow);
}

export async function getSalesInvoice(companyId: string, invoiceId: number): Promise<SalesInvoice | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_invoices")
    .select(INVOICE_SELECT)
    .eq("company_id", companyId)
    .eq("id", invoiceId)
    .maybeSingle<SalesInvoiceRow>();
  if (error) throw error;
  return data ? salesInvoiceFromRow(data) : null;
}

export type NewSalesInvoiceLine = { description: string; quantity: number; unitPrice: number; stockItemId?: number | null };
export type NewSalesInvoice = {
  invoiceNumber?: string;
  customerId: number;
  orderId?: number | null;
  deliveryId?: number | null;
  documentType?: SalesInvoiceDocumentType;
  invoiceDate: string;
  dueDate?: string | null;
  vatTreatmentCode: string;
  isRecurringTemplate?: boolean;
  recurrencePattern?: string;
  reference?: string;
  notes?: string;
  lines: NewSalesInvoiceLine[];
};

function computeTotals(lines: NewSalesInvoiceLine[], vatRatePercent: number) {
  const subtotal = Math.round(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0) * 100) / 100;
  const vatAmount = Math.round(subtotal * (vatRatePercent / 100) * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;
  return { subtotal, vatAmount, total };
}

export async function createSalesInvoice(companyId: string, input: NewSalesInvoice, vatRatePercent: number): Promise<SalesInvoice> {
  const supabase = await createClient();
  const documentType = input.documentType ?? "Invoice";
  const invoiceNumber = input.invoiceNumber ?? (await nextInvoiceNumber(companyId, documentType));
  const { subtotal, vatAmount, total } = computeTotals(input.lines, vatRatePercent);

  const { data: invoiceRow, error: invoiceError } = await supabase
    .from("sales_invoices")
    .insert({
      company_id: companyId,
      customer_id: input.customerId,
      order_id: input.orderId ?? null,
      delivery_id: input.deliveryId ?? null,
      invoice_number: invoiceNumber,
      document_type: documentType,
      invoice_date: input.invoiceDate,
      due_date: input.dueDate ?? null,
      vat_treatment_code: input.vatTreatmentCode,
      subtotal,
      vat_amount: vatAmount,
      total,
      outstanding: total,
      is_recurring_template: input.isRecurringTemplate ?? false,
      recurrence_pattern: input.recurrencePattern ?? "",
      reference: input.reference ?? "",
      notes: input.notes ?? "",
    })
    .select("*")
    .single<SalesInvoiceRow>();
  if (invoiceError) throw invoiceError;

  const { data: lineRows, error: linesError } = await supabase
    .from("sales_invoice_lines")
    .insert(
      input.lines.map((line, index) => ({
        invoice_id: invoiceRow.id,
        line_order: index,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        line_total: Math.round(line.quantity * line.unitPrice * 100) / 100,
        stock_item_id: line.stockItemId ?? null,
      })),
    )
    .select("*");
  if (linesError) throw linesError;

  return salesInvoiceFromRow({ ...invoiceRow, sales_invoice_lines: lineRows });
}

async function setInvoiceFields(companyId: string, invoiceId: number, fields: Record<string, unknown>): Promise<SalesInvoice> {
  const supabase = await createClient();
  const { error } = await supabase.from("sales_invoices").update(fields).eq("company_id", companyId).eq("id", invoiceId);
  if (error) throw error;
  const invoice = await getSalesInvoice(companyId, invoiceId);
  if (!invoice) throw new Error(`No sales invoice with id ${invoiceId}`);
  return invoice;
}

export async function submitInvoice(companyId: string, invoiceId: number): Promise<SalesInvoice> {
  const performedBy = await getPerformedByLabel();
  return setInvoiceFields(companyId, invoiceId, { status: "Submitted", submitted_by: performedBy, submitted_at: new Date().toISOString() });
}

/** Stamps Approved and links the journal the service layer just created —
 * one write, since both happen atomically from the caller's perspective. */
export async function approveInvoice(companyId: string, invoiceId: number, journalId: number): Promise<SalesInvoice> {
  const performedBy = await getPerformedByLabel();
  return setInvoiceFields(companyId, invoiceId, {
    status: "Approved",
    approved_by: performedBy,
    approved_at: new Date().toISOString(),
    journal_id: journalId,
  });
}

export async function markInvoicePosted(companyId: string, invoiceId: number): Promise<SalesInvoice> {
  return setInvoiceFields(companyId, invoiceId, { status: "Posted", posted_at: new Date().toISOString() });
}

export async function cancelInvoice(companyId: string, invoiceId: number): Promise<SalesInvoice> {
  const performedBy = await getPerformedByLabel();
  return setInvoiceFields(companyId, invoiceId, { status: "Cancelled", cancelled_by: performedBy, cancelled_at: new Date().toISOString() });
}

export async function reduceInvoiceOutstanding(companyId: string, invoiceId: number, amount: number): Promise<SalesInvoice> {
  const invoice = await getSalesInvoice(companyId, invoiceId);
  if (!invoice) throw new Error(`No sales invoice with id ${invoiceId}`);
  const outstanding = Math.round((invoice.outstanding - amount) * 100) / 100;
  return setInvoiceFields(companyId, invoiceId, { outstanding });
}

export { incrementOrderLineQuantity };
