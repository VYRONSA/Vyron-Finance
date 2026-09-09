/**
 * Repository layer for Supplier Bills entered through the new Purchasing
 * workflow — operates on the SAME `ae_imported_bills` table Import
 * Centre/Supplier Reconciliation already use (see
 * `0011_purchasing_platform.sql`'s header comment for why this is
 * additive, not a competing table), scoped to `origin = 'Purchasing'`
 * rows so imported bills are never touched by this file.
 *
 * Deliberately header-level, not line-itemized: `ae_imported_bills` has
 * no line-items table (imported bills never had one either — a CSV/PDF
 * import row is just a total), so a Purchasing-entered bill is a single
 * net amount + VAT treatment, matching the table's real existing shape
 * rather than bolting on a parallel line-items concept.
 *
 * Unlike Sales Invoices (where WE generate the invoice number), a
 * supplier bill's `invoice_number` is the SUPPLIER's own reference —
 * always caller-supplied, never auto-generated.
 */

import { createClient } from "@/lib/supabase/server";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { billFromRow, purchaseBillLineFromRow, type ImportedBillRow, type PurchaseBillLineRow } from "@/server/accounting/mappers";
import type { ImportedBill, PurchaseBillLine } from "@/server/accounting/types";

const BILL_SELECT = "*";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the full rationale; same safety bound applied here.
const LIST_CAP = 10_000;

export async function listPurchaseBills(companyId: string): Promise<ImportedBill[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_imported_bills")
    .select(BILL_SELECT)
    .eq("company_id", companyId)
    .eq("origin", "Purchasing")
    .order("invoice_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<ImportedBillRow[]>();
  if (error) throw error;
  return data.map(billFromRow);
}

export async function listPurchaseBillsBySupplier(companyId: string, supplierId: number): Promise<ImportedBill[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_imported_bills")
    .select(BILL_SELECT)
    .eq("company_id", companyId)
    .eq("supplier_id", supplierId)
    .eq("origin", "Purchasing")
    .order("invoice_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<ImportedBillRow[]>();
  if (error) throw error;
  return data.map(billFromRow);
}

/** By id, not scoped to `origin = 'Purchasing'` — Supplier Payments need
 * to look up and reduce the outstanding on ANY bill (imported or
 * Purchasing-entered), since a payment can settle either. */
export async function getPurchaseBill(companyId: string, billId: number): Promise<ImportedBill | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_imported_bills")
    .select(BILL_SELECT)
    .eq("company_id", companyId)
    .eq("id", billId)
    .maybeSingle<ImportedBillRow>();
  if (error) throw error;
  return data ? billFromRow(data) : null;
}

export type NewPurchaseBill = {
  supplierId: number;
  supplierName: string;
  invoiceNumber: string;
  documentType?: "Bill" | "Credit Note" | "Debit Note";
  invoiceDate: string;
  dueDate?: string | null;
  purchaseOrderId?: number | null;
  goodsReceivedNoteId?: number | null;
  glAccount?: string | null;
  vatCode?: string | null;
};

function computeTotals(subtotal: number, vatRatePercent: number) {
  const vat = Math.round(subtotal * (vatRatePercent / 100) * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  return { vat, total };
}

export async function createPurchaseBill(companyId: string, input: NewPurchaseBill, subtotal: number, vatRatePercent: number): Promise<ImportedBill> {
  const supabase = await createClient();
  const { vat, total } = computeTotals(subtotal, vatRatePercent);

  const { data, error } = await supabase
    .from("ae_imported_bills")
    .insert({
      company_id: companyId,
      supplier_id: input.supplierId,
      supplier_name: input.supplierName,
      invoice_number: input.invoiceNumber,
      document_type: input.documentType ?? "Bill",
      invoice_date: input.invoiceDate,
      due_date: input.dueDate ?? null,
      vat,
      total,
      outstanding: total,
      status: "Open",
      gl_account: input.glAccount ?? null,
      vat_code: input.vatCode ?? null,
      origin: "Purchasing",
      purchase_order_id: input.purchaseOrderId ?? null,
      goods_received_note_id: input.goodsReceivedNoteId ?? null,
      posting_status: "Draft",
    })
    .select("*")
    .single<ImportedBillRow>();
  if (error) throw error;
  return billFromRow(data);
}

export type NewPurchaseBillLine = {
  description: string;
  glAccount: string;
  vatCode: string;
  costCentreId: number | null;
  projectId: number | null;
  departmentId: number | null;
  quantity: number;
  unitCost: number;
  discount: number;
  netAmount: number;
  vatAmount: number;
  lineTotal: number;
};

/** "Additional Requirement: Purchase Processing" — the multi-line
 * capture path. Header totals (`vat`/`total`) are the caller's own
 * roll-up of the lines, not recomputed here (see
 * `purchase-bill-service.ts::createPurchaseBill`) — this repository
 * layer stays a thin insert, same as every other table in this
 * codebase. Header + lines insert sequentially, not in a DB
 * transaction, matching this codebase's established pattern elsewhere
 * (e.g. `import-service.ts`'s per-row loop) for multi-statement writes
 * through the Supabase JS client. */
export async function createPurchaseBillWithLines(
  companyId: string,
  input: NewPurchaseBill,
  vat: number,
  total: number,
  lines: NewPurchaseBillLine[],
): Promise<{ bill: ImportedBill; lines: PurchaseBillLine[] }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ae_imported_bills")
    .insert({
      company_id: companyId,
      supplier_id: input.supplierId,
      supplier_name: input.supplierName,
      invoice_number: input.invoiceNumber,
      document_type: input.documentType ?? "Bill",
      invoice_date: input.invoiceDate,
      due_date: input.dueDate ?? null,
      vat,
      total,
      outstanding: total,
      status: "Open",
      gl_account: input.glAccount ?? null,
      vat_code: input.vatCode ?? null,
      origin: "Purchasing",
      purchase_order_id: input.purchaseOrderId ?? null,
      goods_received_note_id: input.goodsReceivedNoteId ?? null,
      posting_status: "Draft",
    })
    .select("*")
    .single<ImportedBillRow>();
  if (error) throw error;
  const bill = billFromRow(data);

  const { data: lineRows, error: linesError } = await supabase
    .from("ae_purchase_bill_lines")
    .insert(
      lines.map((line, index) => ({
        company_id: companyId,
        bill_id: bill.id,
        line_order: index,
        description: line.description,
        gl_account: line.glAccount,
        vat_code: line.vatCode,
        cost_centre_id: line.costCentreId,
        project_id: line.projectId,
        department_id: line.departmentId,
        quantity: line.quantity,
        unit_cost: line.unitCost,
        discount: line.discount,
        net_amount: line.netAmount,
        vat_amount: line.vatAmount,
        line_total: line.lineTotal,
      })),
    )
    .select("*")
    .returns<PurchaseBillLineRow[]>();
  if (linesError) throw linesError;

  return { bill, lines: lineRows.map(purchaseBillLineFromRow) };
}

export async function listPurchaseBillLines(companyId: string, billId: number): Promise<PurchaseBillLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_purchase_bill_lines")
    .select("*")
    .eq("company_id", companyId)
    .eq("bill_id", billId)
    .order("line_order", { ascending: true })
    .returns<PurchaseBillLineRow[]>();
  if (error) throw error;
  return data.map(purchaseBillLineFromRow);
}

/** Editing a Draft bill's lines — deletes the old set and inserts the
 * new one rather than diffing row-by-row (a Draft has no journal, no
 * payments allocated against it, and no audit-trail expectation yet —
 * the same "safe to fully replace" reasoning `bulkUpsertGlOpeningBalances`
 * documented for Opening Balances), then updates the header's own
 * roll-up fields (`vat`/`total`/`outstanding`/`gl_account`/`vat_code`)
 * to match. `outstanding` is reset to the new `total` — a Draft bill has
 * never had a payment allocated against it (only Posted bills can be
 * paid), so there is no partial-payment state to preserve. */
export async function replacePurchaseBillLines(
  companyId: string,
  billId: number,
  header: { vat: number; total: number; glAccount: string; vatCode: string },
  lines: NewPurchaseBillLine[],
): Promise<{ bill: ImportedBill; lines: PurchaseBillLine[] }> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase.from("ae_purchase_bill_lines").delete().eq("company_id", companyId).eq("bill_id", billId);
  if (deleteError) throw deleteError;

  const { data: lineRows, error: linesError } = await supabase
    .from("ae_purchase_bill_lines")
    .insert(
      lines.map((line, index) => ({
        company_id: companyId,
        bill_id: billId,
        line_order: index,
        description: line.description,
        gl_account: line.glAccount,
        vat_code: line.vatCode,
        cost_centre_id: line.costCentreId,
        project_id: line.projectId,
        department_id: line.departmentId,
        quantity: line.quantity,
        unit_cost: line.unitCost,
        discount: line.discount,
        net_amount: line.netAmount,
        vat_amount: line.vatAmount,
        line_total: line.lineTotal,
      })),
    )
    .select("*")
    .returns<PurchaseBillLineRow[]>();
  if (linesError) throw linesError;

  const bill = await setBillFields(companyId, billId, {
    vat: header.vat,
    total: header.total,
    outstanding: header.total,
    gl_account: header.glAccount,
    vat_code: header.vatCode,
  });

  return { bill, lines: lineRows.map(purchaseBillLineFromRow) };
}

async function setBillFields(companyId: string, billId: number, fields: Record<string, unknown>): Promise<ImportedBill> {
  const supabase = await createClient();
  const { error } = await supabase.from("ae_imported_bills").update(fields).eq("company_id", companyId).eq("id", billId);
  if (error) throw error;
  const bill = await getPurchaseBill(companyId, billId);
  if (!bill) throw new Error(`No purchase bill with id ${billId}`);
  return bill;
}

export async function submitBill(companyId: string, billId: number): Promise<ImportedBill> {
  const performedBy = await getPerformedByLabel();
  return setBillFields(companyId, billId, { posting_status: "Submitted", submitted_by: performedBy, submitted_at: new Date().toISOString() });
}

/** Stamps Approved and links the journal the service layer just created —
 * one write, mirroring `sales-invoice-repository.ts::approveInvoice`. */
export async function approveBill(companyId: string, billId: number, journalId: number): Promise<ImportedBill> {
  const performedBy = await getPerformedByLabel();
  return setBillFields(companyId, billId, {
    posting_status: "Approved",
    approved_by: performedBy,
    approved_at: new Date().toISOString(),
    journal_id: journalId,
  });
}

export async function markBillPosted(companyId: string, billId: number): Promise<ImportedBill> {
  return setBillFields(companyId, billId, { posting_status: "Posted", posted_at: new Date().toISOString() });
}

export async function cancelBill(companyId: string, billId: number): Promise<ImportedBill> {
  const performedBy = await getPerformedByLabel();
  return setBillFields(companyId, billId, { posting_status: "Cancelled", cancelled_by: performedBy, cancelled_at: new Date().toISOString() });
}

export async function reduceBillOutstanding(companyId: string, billId: number, amount: number): Promise<ImportedBill> {
  const bill = await getPurchaseBill(companyId, billId);
  if (!bill) throw new Error(`No bill with id ${billId}`);
  const outstanding = Math.round((bill.outstanding - amount) * 100) / 100;
  return setBillFields(companyId, billId, { outstanding });
}
