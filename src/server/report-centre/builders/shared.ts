/**
 * Small accounting helpers shared by the GL, Financial, VAT and
 * Management report families.
 */

import { suggestFinancialYear } from "@/server/services/financial-year-service";
import type { AccountType, ChartOfAccount, NormalBalance, TrialBalanceRow } from "@/server/general-ledger/types";
import { drill } from "../kit";
import type { ReportContext } from "../kit";
import { round2, type DocumentType, type DrillTarget } from "../types";

export const ACCOUNT_TYPE_ORDER: AccountType[] = ["Asset", "Liability", "Equity", "Income", "Cost of Sales", "Expense", "Other Income", "Other Expense"];

export const PROFIT_AND_LOSS_TYPES: AccountType[] = ["Income", "Cost of Sales", "Expense", "Other Income", "Other Expense"];

/** The financial year containing `date` — the company's own recorded
 * year when one exists, otherwise the year its configured start month
 * implies (the same fallback the Reports page already uses). */
export async function financialYearFor(ctx: ReportContext, date: string): Promise<{ label: string; start: string; end: string }> {
  const years = await ctx.source.financialYears();
  const fy = years.find((y) => y.startDate <= date && date <= y.endDate);
  if (fy) return { label: fy.yearLabel, start: fy.startDate, end: fy.endDate };
  const suggested = suggestFinancialYear(date, ctx.company.financialYearStartMonth);
  return { label: suggested.yearLabel, start: suggested.startDate, end: suggested.endDate };
}

/** A balance in the account's natural sign — positive when it sits on
 * its normal side. */
export function naturalBalance(normal: NormalBalance, debit: number, credit: number): number {
  return round2(normal === "Debit" ? debit - credit : credit - debit);
}

/** Net debit-positive balance of a Trial Balance row. */
export function netDebit(row: Pick<TrialBalanceRow, "totalDebit" | "totalCredit"> | undefined): number {
  return row ? round2(row.totalDebit - row.totalCredit) : 0;
}

export function accountsById(accounts: ChartOfAccount[]): Map<number, ChartOfAccount> {
  return new Map(accounts.map((a) => [a.id, a]));
}

const SOURCE_DOCUMENT: Record<string, DocumentType> = {
  sales_invoice: "sales-invoice",
  purchase_bill: "purchase-bill",
  customer_receipt: "customer-receipt",
  supplier_payment: "supplier-payment",
};

/** A journal's source document, when it was generated from one VYRON
 * can show. */
export function sourceDocumentDrill(sourceType: string, sourceId: number | null): DrillTarget | undefined {
  const docType = SOURCE_DOCUMENT[sourceType];
  return docType && sourceId !== null ? drill.document(docType, sourceId) : undefined;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual Journal",
  sales_invoice: "Sales Invoice",
  purchase_bill: "Purchase Bill",
  customer_receipt: "Customer Receipt",
  supplier_payment: "Supplier Payment",
  bank_transactions_bulk: "Bank Posting",
  bank_transaction_rule_engine: "Bank Rule",
  cashbook_entry: "Cashbook",
  cashbook_transfer: "Cashbook Transfer",
  OpeningBalance: "Opening Balance",
  journal_reversal: "Reversal",
  vat_return: "VAT Return",
  vat_payment: "VAT Payment",
  vat_adjustment: "VAT Adjustment",
  depreciation_run: "Depreciation",
  fixed_asset: "Fixed Asset",
  fixed_asset_disposal: "Asset Disposal",
  recurring_template: "Recurring",
  delivery: "Delivery",
  delivery_reversal: "Delivery Reversal",
  goods_received_note: "Goods Received",
  inventory_transaction: "Inventory",
  stock_take: "Stock Take",
};

export function sourceLabel(sourceType: string): string {
  return SOURCE_LABEL[sourceType] ?? (sourceType || "Manual Journal");
}
