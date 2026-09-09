/**
 * Pure report-shaping functions — the actual port of
 * `accounting_engine/reconciliation_reports.py`. Take plain domain
 * objects in, return plain report rows out; no I/O. Used by both the
 * repository-backed report builders (`reconciliation-reports.ts`) and
 * Preview Mode's mock data (`lib/mock/supplier-reconciliation-data.ts`),
 * so the two paths can never disagree about how a report is computed.
 */

import { REQUIRED_ACTION_DUPLICATE_PAYMENT } from "./matching-engine";
import type { BankTransactionRecord, ImportedBill, Supplier } from "./types";

export type DashboardCounts = {
  billsImported: number;
  creditNotesImported: number;
  bankTransactionsImported: number;
  matched: number;
  allocated: number;
  suggested: number;
  unallocated: number;
  outstandingWorkQueueItems: number;
};

export function shapeDashboardCounts(
  bills: ImportedBill[],
  transactions: BankTransactionRecord[],
  outstandingWorkQueueItems: number,
): DashboardCounts {
  return {
    billsImported: bills.filter((b) => b.documentType === "Bill").length,
    creditNotesImported: bills.filter((b) => b.documentType === "Credit Note").length,
    bankTransactionsImported: transactions.length,
    matched: transactions.filter((t) => t.allocationStatus === "Matched").length,
    allocated: transactions.filter((t) => t.allocationStatus === "Allocated").length,
    suggested: transactions.filter((t) => t.allocationStatus === "Suggested").length,
    unallocated: transactions.filter((t) => t.allocationStatus === "Unallocated").length,
    outstandingWorkQueueItems,
  };
}

export type SupplierAllocationRow = {
  date: string | null;
  supplier: string;
  invoiceNumber: string;
  debit: number;
  allocationStatus: string;
  glAccount: string | null;
  vatCode: string | null;
  confidence: number | null;
  allocationMethod: string | null;
  reason: string;
};

export function shapeSupplierAllocationRows(
  transactions: BankTransactionRecord[],
  suppliers: Supplier[],
  bills: ImportedBill[],
): SupplierAllocationRow[] {
  const suppliersById = new Map(suppliers.map((s) => [s.id, s]));
  const billsById = new Map(bills.map((b) => [b.id, b]));

  return transactions
    .filter((t) => t.debit > 0)
    .map((t) => ({
      date: t.transactionDate,
      supplier: t.matchedSupplierId !== null ? (suppliersById.get(t.matchedSupplierId)?.name ?? t.beneficiary) : t.beneficiary,
      invoiceNumber: t.matchedBillId !== null ? (billsById.get(t.matchedBillId)?.invoiceNumber ?? "") : "",
      debit: t.debit,
      allocationStatus: t.allocationStatus,
      glAccount: t.suggestedGlAccount,
      vatCode: t.suggestedVatCode,
      confidence: t.confidenceScore,
      allocationMethod: t.allocationMethod,
      reason: t.allocationReason || t.matchReason,
    }));
}

export type SupplierPaymentRow = {
  supplierName: string;
  paymentsCount: number;
  totalPaid: number;
};

export function shapeSupplierPaymentRows(transactions: BankTransactionRecord[], suppliers: Supplier[]): SupplierPaymentRow[] {
  const suppliersById = new Map(suppliers.map((s) => [s.id, s]));
  const totals = new Map<string, SupplierPaymentRow>();
  for (const t of transactions) {
    if (t.allocationStatus !== "Matched" && t.allocationStatus !== "Allocated") continue;
    const name = t.matchedSupplierId !== null ? (suppliersById.get(t.matchedSupplierId)?.name ?? t.beneficiary) : t.beneficiary;
    const existing = totals.get(name) ?? { supplierName: name, paymentsCount: 0, totalPaid: 0 };
    existing.paymentsCount += 1;
    existing.totalPaid += t.debit;
    totals.set(name, existing);
  }
  return [...totals.values()];
}

export type OutstandingSupplierRow = {
  supplier: string;
  invoiceNumber: string;
  documentType: ImportedBill["documentType"];
  invoiceDate: string | null;
  dueDate: string | null;
  total: number;
  outstanding: number;
};

export function shapeOutstandingSuppliersRows(openBills: ImportedBill[]): OutstandingSupplierRow[] {
  return openBills.map((b) => ({
    supplier: b.supplierName,
    invoiceNumber: b.invoiceNumber,
    documentType: b.documentType,
    invoiceDate: b.invoiceDate,
    dueDate: b.dueDate,
    total: b.total,
    outstanding: b.outstanding,
  }));
}

export type UnknownPaymentRow = {
  date: string | null;
  beneficiary: string;
  description: string;
  debit: number;
};

export function shapeUnknownPaymentsRows(transactions: BankTransactionRecord[]): UnknownPaymentRow[] {
  return transactions
    .filter((t) => t.allocationStatus === "Unallocated" && t.debit > 0)
    .map((t) => ({ date: t.transactionDate, beneficiary: t.beneficiary, description: t.description, debit: t.debit }));
}

export type DuplicatePaymentRow = {
  date: string | null;
  beneficiary: string;
  invoiceNumber: string;
  debit: number;
};

export function shapeDuplicatePaymentsRows(transactions: BankTransactionRecord[], bills: ImportedBill[]): DuplicatePaymentRow[] {
  const billsById = new Map(bills.map((b) => [b.id, b]));
  return transactions
    .filter((t) => t.requiredAction === REQUIRED_ACTION_DUPLICATE_PAYMENT)
    .map((t) => ({
      date: t.transactionDate,
      beneficiary: t.beneficiary,
      invoiceNumber: t.matchedBillId !== null ? (billsById.get(t.matchedBillId)?.invoiceNumber ?? "") : "",
      debit: t.debit,
    }));
}
