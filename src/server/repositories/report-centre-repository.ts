/**
 * Read-only, COMPLETE reads for the Reporting Centre.
 *
 * Why this file exists instead of reusing the modules' own `list*`
 * functions: those are capped with `.limit(LIST_CAP)` for interactive
 * screens, and PostgREST additionally caps every single response at
 * `max_rows` (1000 — see `supabase/config.toml`). A report that silently
 * read only the first 1000 bank transactions or invoices would produce
 * wrong totals with no warning. Every read here pages through the whole
 * result with `.range()` on a stable order, reusing each module's OWN
 * select string and row mapper so a record means exactly the same thing
 * here as everywhere else, and reports `truncated` if the hard ceiling
 * is ever reached rather than hiding it.
 *
 * This file only ever SELECTs. It must never insert, update, delete,
 * upsert or call a mutating RPC (enforced by
 * `src/server/report-centre/read-only.test.ts`).
 */

import { createClient } from "@/lib/supabase/server";
import {
  allocationHistoryFromRow,
  bankTransactionFromRow,
  billFromRow,
  journalFromRow,
  purchaseBillLineFromRow,
  supplierFromRow,
  type AllocationHistoryRow,
  type BankTransactionRow,
  type ImportedBillRow,
  type JournalRow,
  type PurchaseBillLineRow,
  type SupplierRow,
} from "@/server/accounting/mappers";
import { glTransactionWithContextFromRow, type GlTransactionWithContextRow } from "@/server/general-ledger/mappers";
import { customerFromRow, type CustomerRow } from "@/server/customer-management/mappers";
import { customerReceiptFromRow, quotationFromRow, salesInvoiceFromRow, salesOrderFromRow, type CustomerReceiptRow, type QuotationRow, type SalesInvoiceRow, type SalesOrderRow } from "@/server/sales/mappers";
import { purchaseOrderFromRow, supplierPaymentFromRow, type PurchaseOrderRow, type SupplierPaymentRow } from "@/server/purchasing/mappers";
import { inventoryTransactionFromRow, stockItemFromRow, type InventoryTransactionRow, type StockItemRow } from "@/server/inventory/mappers";
import { openingBalanceEntryFromRow, type OpeningBalanceEntryRow } from "@/server/opening-balances/mappers";
import type { AllocationHistoryEntry, BankTransactionRecord, ImportedBill, Journal, PurchaseBillLine, Supplier } from "@/server/accounting/types";
import type { GlTransactionWithContext } from "@/server/general-ledger/types";
import type { Customer } from "@/server/customer-management/types";
import type { CustomerReceipt, Quotation, SalesInvoice, SalesOrder } from "@/server/sales/types";
import type { PurchaseOrder, SupplierPayment } from "@/server/purchasing/types";
import type { InventoryTransaction, StockItem } from "@/server/inventory/types";
import type { OpeningBalanceEntry } from "@/server/opening-balances/types";

/** PostgREST's per-response ceiling (`max_rows`). */
const PAGE_SIZE = 1000;
/** Hard ceiling per report read — far above any current company's
 * volume; hitting it is reported as `truncated`, never silently. */
export const REPORT_ROW_CAP = 250_000;

export type CappedRows<T> = { items: T[]; truncated: boolean };
export type Window = { from?: string; to?: string };

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

async function readAllPages<Row, T>(page: (from: number, to: number) => Page<Row>, map: (row: Row) => T): Promise<CappedRows<T>> {
  const items: T[] = [];
  for (let from = 0; from < REPORT_ROW_CAP; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) items.push(map(row));
    if (rows.length < PAGE_SIZE) return { items, truncated: false };
  }
  return { items, truncated: true };
}

/** Same select + mapper as `gl-repository.ts::GL_SELECT` — the account/
 * journal identity each GL line carries for drill-down. */
const GL_SELECT = "*, chart_of_accounts!inner(account_code, description, branch_id, department_id, cost_centre_id), ae_journals!inner(journal_number, source_type)";

export async function readGlTransactions(companyId: string, window: Window & { accountId?: number }): Promise<CappedRows<GlTransactionWithContext>> {
  const supabase = await createClient();
  return readAllPages<GlTransactionWithContextRow, GlTransactionWithContext>((from, to) => {
    let q = supabase.from("gl_transactions").select(GL_SELECT).eq("company_id", companyId);
    if (window.from) q = q.gte("posting_date", window.from);
    if (window.to) q = q.lte("posting_date", window.to);
    if (window.accountId !== undefined) q = q.eq("account_id", window.accountId);
    return q.order("posting_date", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<GlTransactionWithContextRow[]>();
  }, glTransactionWithContextFromRow);
}

/** Same select + mapper as `transaction-explorer-repository.ts`. */
const BANK_TRANSACTION_SELECT = "*, matched_supplier:ae_suppliers(name)";

export async function readBankTransactions(companyId: string, window: Window): Promise<CappedRows<BankTransactionRecord>> {
  const supabase = await createClient();
  return readAllPages<BankTransactionRow, BankTransactionRecord>((from, to) => {
    let q = supabase.from("ae_bank_transactions").select(BANK_TRANSACTION_SELECT).eq("company_id", companyId);
    if (window.from) q = q.gte("transaction_date", window.from);
    if (window.to) q = q.lte("transaction_date", window.to);
    return q.order("transaction_date", { ascending: true, nullsFirst: true }).order("id", { ascending: true }).range(from, to).returns<BankTransactionRow[]>();
  }, bankTransactionFromRow);
}

export async function readAllocationHistory(companyId: string, window: Window): Promise<CappedRows<AllocationHistoryEntry>> {
  const supabase = await createClient();
  return readAllPages<AllocationHistoryRow, AllocationHistoryEntry>((from, to) => {
    let q = supabase.from("ae_allocation_history").select("*").eq("company_id", companyId);
    if (window.from) q = q.gte("created_at", `${window.from}T00:00:00Z`);
    if (window.to) q = q.lte("created_at", `${window.to}T23:59:59.999Z`);
    return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<AllocationHistoryRow[]>();
  }, allocationHistoryFromRow);
}

/** A whole company table, paged on `id`, through its own mapper. */
async function readTable<Row, T>(table: string, select: string, companyId: string, map: (row: Row) => T): Promise<CappedRows<T>> {
  const supabase = await createClient();
  return readAllPages<Row, T>(
    (from, to) => supabase.from(table).select(select).eq("company_id", companyId).order("id", { ascending: true }).range(from, to).returns<Row[]>(),
    map,
  );
}

export const readJournals = (companyId: string) => readTable<JournalRow, Journal>("ae_journals", "*, ae_journal_lines(*)", companyId, journalFromRow);
export const readCustomers = (companyId: string) => readTable<CustomerRow, Customer>("customers", "*", companyId, customerFromRow);
export const readSuppliers = (companyId: string) => readTable<SupplierRow, Supplier>("ae_suppliers", "*", companyId, supplierFromRow);
export const readSalesInvoices = (companyId: string) => readTable<SalesInvoiceRow, SalesInvoice>("sales_invoices", "*, sales_invoice_lines(*)", companyId, salesInvoiceFromRow);
export const readCustomerReceipts = (companyId: string) => readTable<CustomerReceiptRow, CustomerReceipt>("customer_receipts", "*, customer_receipt_allocations(*)", companyId, customerReceiptFromRow);
export const readQuotations = (companyId: string) => readTable<QuotationRow, Quotation>("sales_quotations", "*, sales_quotation_lines(*)", companyId, quotationFromRow);
export const readSalesOrders = (companyId: string) => readTable<SalesOrderRow, SalesOrder>("sales_orders", "*, sales_order_lines(*)", companyId, salesOrderFromRow);
export const readBills = (companyId: string) => readTable<ImportedBillRow, ImportedBill>("ae_imported_bills", "*", companyId, billFromRow);
export const readBillLines = (companyId: string) => readTable<PurchaseBillLineRow, PurchaseBillLine>("ae_purchase_bill_lines", "*", companyId, purchaseBillLineFromRow);
export const readSupplierPayments = (companyId: string) => readTable<SupplierPaymentRow, SupplierPayment>("supplier_payments", "*, supplier_payment_allocations(*)", companyId, supplierPaymentFromRow);
export const readPurchaseOrders = (companyId: string) => readTable<PurchaseOrderRow, PurchaseOrder>("purchase_orders", "*, purchase_order_lines(*)", companyId, purchaseOrderFromRow);
export const readInventoryTransactions = (companyId: string) =>
  readTable<InventoryTransactionRow, InventoryTransaction>("inventory_transactions", "*, inventory_transaction_lines(*)", companyId, inventoryTransactionFromRow);
export const readOpeningBalances = (companyId: string) => readTable<OpeningBalanceEntryRow, OpeningBalanceEntry>("opening_balance_entries", "*", companyId, openingBalanceEntryFromRow);
export const readStockItems = (companyId: string) => readTable<StockItemRow, StockItem>("stock_items", "*", companyId, stockItemFromRow);
