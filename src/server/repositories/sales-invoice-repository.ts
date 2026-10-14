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
import type { InvoiceTotals } from "@/server/sales/invoice-totals";
import type { SalesInvoice, SalesInvoiceDocumentType, SalesInvoiceStatus } from "@/server/sales/types";

const INVOICE_SELECT = "*, sales_invoice_lines(*)";
// Phase 5J — the INV/CN/DN prefixes moved into the database with the
// counter that uses them (`document_number_prefix()` in 0105), so the
// format is defined once, next to the uniqueness guarantee that depends
// on it, rather than in a constant the DB cannot see.

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the full rationale; same safety bound applied here.
const LIST_CAP = 10_000;

/**
 * Phase 5J — claims the next number from the company's own counter
 * (`0105_document_number_sequences.sql`), atomically.
 *
 * This used to be `COUNT(*) + 1` over this company's documents of this
 * type, which had two defects. It raced: two invoices created in the same
 * instant both counted N, both proposed N+1, and the loser hit
 * `sales_invoices_company_id_invoice_number_key` as an unhandled 500 with
 * an invoice half-created. And it was not stable: COUNT falls when a row
 * is deleted, so it could re-propose a number already issued — one serial
 * number on two tax documents, which is precisely what VAT Act s20(4)(b)
 * forbids.
 *
 * The counter row is claimed inside a single SQL statement, so Postgres
 * serialises concurrent claims on that one row. See the migration's
 * header for why a counter row rather than a Postgres sequence (a
 * sequence's `nextval` survives rollback, burning numbers) and for why
 * gaps are acceptable but re-use is not.
 */
export async function nextInvoiceNumber(companyId: string, documentType: SalesInvoiceDocumentType): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("next_document_number", {
    p_company_id: companyId,
    p_document_type: documentType,
  });
  if (error) throw error;
  if (typeof data !== "string" || data.length === 0) {
    throw new Error(`Could not allocate a ${documentType} number for company ${companyId}.`);
  }
  return data;
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

/** Finding #165 added `glAccount`/`vatCode`/`discount`/`netAmount`/
 * `vatAmount` as informational per-line capture, deliberately NOT rolled
 * up into the header figures that drive the GL posting — capturing the
 * detail without changing any accounting math.
 *
 * Phase 5J closes that gap: `vatCode` and `discount` are now INPUTS to
 * the invoice's real subtotal/VAT/total, computed server-side by
 * `sales/invoice-totals.ts`. `netAmount`/`vatAmount` are no longer
 * accepted from the caller at all — they are outputs now, and letting a
 * request supply them would let a client decide what VAT it owes. */
export type NewSalesInvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  stockItemId?: number | null;
  glAccount?: string | null;
  /** This line's own VAT treatment code; falls back to the document's
   * header `vatTreatmentCode` when absent. */
  vatCode?: string | null;
  /** Money off this line, not a percentage — the same meaning `discount`
   * already has on Purchase Orders, Purchase Bills and Sales Orders
   * (`purchasing/line-amounts.ts`). VAT is charged on what remains. */
  discount?: number;
};
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
  /** Finding #114 — which Invoice this Credit Note reverses. */
  originalInvoiceId?: number | null;
  /** Phase 5J — why a Credit/Debit Note was issued (VAT Act s21(3)). */
  reason?: string;
  /** Phase 5J — the terms `dueDate` was derived from, or null when it was
   * set by hand. Recorded, never re-derived later. */
  paymentTermsDays?: number | null;
  lines: NewSalesInvoiceLine[];
};

/**
 * Phase 5J — the invoice's figures now come from ONE place
 * (`sales/invoice-totals.ts`), computed from the per-line VAT codes and
 * discounts the form has captured all along.
 *
 * What this replaced: `computeTotals`, which summed `quantity * unitPrice`
 * and applied one flat header rate to the lot — ignoring every per-line
 * `vatCode` and `discount`, so a line marked Zero Rated was still charged
 * VAT and a discount changed nothing at all.
 *
 * The caller resolves VAT codes to rates (it is the layer that can read
 * `vat_treatments` and refuse an unknown code with a useful message) and
 * hands the finished figures down. This function stores them; it does not
 * second-guess them.
 */
export async function createSalesInvoice(companyId: string, input: NewSalesInvoice, totals: InvoiceTotals): Promise<SalesInvoice> {
  const supabase = await createClient();
  const documentType = input.documentType ?? "Invoice";
  const invoiceNumber = input.invoiceNumber ?? (await nextInvoiceNumber(companyId, documentType));
  const { subtotal, vatAmount, total } = totals;

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
      original_invoice_id: input.originalInvoiceId ?? null,
      reason: input.reason ?? "",
      payment_terms_days: input.paymentTermsDays ?? null,
    })
    .select("*")
    .single<SalesInvoiceRow>();
  if (invoiceError) throw invoiceError;

  const { data: lineRows, error: linesError } = await supabase
    .from("sales_invoice_lines")
    .insert(
      // Phase 5J — every stored line figure comes from the same
      // calculation that produced the header, so the lines a customer
      // reads off the document always add up to the total they are being
      // asked to pay. `line_total` is now net + VAT for that line (it
      // used to be `quantity * unitPrice`, which ignored both the
      // discount and the VAT and so could not agree with anything).
      input.lines.map((line, index) => {
        const amounts = totals.lines[index];
        return {
          invoice_id: invoiceRow.id,
          line_order: index,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: amounts.lineTotal,
          stock_item_id: line.stockItemId ?? null,
          gl_account: line.glAccount ?? null,
          vat_code: line.vatCode ?? null,
          discount: amounts.discount,
          net_amount: amounts.netAmount,
          vat_amount: amounts.vatAmount,
        };
      }),
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

/** Sets `gl_account` on the named lines of one invoice, ONLY where it is
 * still empty — a line that already has an account is never overwritten.
 * Touches no other column (amounts, VAT and totals stay as stored).
 * Returns the ids actually changed. The service layer decides who may do
 * this and when (Draft only) and records the audit entry. */
export async function setMissingLineAccounts(invoiceId: number, lineIds: number[], glAccount: string): Promise<number[]> {
  if (lineIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_invoice_lines")
    .update({ gl_account: glAccount })
    .eq("invoice_id", invoiceId)
    .in("id", lineIds)
    .is("gl_account", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).map((r: { id: number }) => r.id);
}

/** Puts the named lines back to "no account" — used only to undo
 * `setMissingLineAccounts` when its audit entry could not be recorded. */
export async function clearLineAccounts(invoiceId: number, lineIds: number[], glAccount: string): Promise<void> {
  if (lineIds.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("sales_invoice_lines")
    .update({ gl_account: null })
    .eq("invoice_id", invoiceId)
    .in("id", lineIds)
    .eq("gl_account", glAccount);
  if (error) throw error;
}

export { incrementOrderLineQuantity };
