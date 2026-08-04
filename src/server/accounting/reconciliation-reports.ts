/**
 * Repository-backed report builders — fetch via the repository layer,
 * then delegate all shaping to `reconciliation-report-shapes.ts` (the
 * actual port of `accounting_engine/reconciliation_reports.py`).
 */

import * as repo from "@/server/repositories/supplier-reconciliation-repository";
import * as shapes from "./reconciliation-report-shapes";

export type { DashboardCounts, DuplicatePaymentRow, OutstandingSupplierRow, SupplierAllocationRow, SupplierPaymentRow, UnknownPaymentRow } from "./reconciliation-report-shapes";

export async function buildDashboardCounts(companyId: string): Promise<shapes.DashboardCounts> {
  const [bills, transactions, outstandingWorkQueueItems] = await Promise.all([
    repo.listAllBills(companyId),
    repo.listBankTransactions(companyId),
    repo.countOpenWorkItems(companyId),
  ]);
  return shapes.shapeDashboardCounts(bills, transactions, outstandingWorkQueueItems);
}

export async function buildSupplierAllocationRows(companyId: string): Promise<shapes.SupplierAllocationRow[]> {
  const [transactions, suppliers, bills] = await Promise.all([
    repo.listBankTransactions(companyId),
    repo.listSuppliers(companyId),
    repo.listAllBills(companyId),
  ]);
  return shapes.shapeSupplierAllocationRows(transactions, suppliers, bills);
}

export async function buildSupplierPaymentRows(companyId: string): Promise<shapes.SupplierPaymentRow[]> {
  const [transactions, suppliers] = await Promise.all([repo.listBankTransactions(companyId), repo.listSuppliers(companyId)]);
  return shapes.shapeSupplierPaymentRows(transactions, suppliers);
}

export async function buildOutstandingSuppliersRows(companyId: string): Promise<shapes.OutstandingSupplierRow[]> {
  const bills = await repo.listOpenBills(companyId);
  return shapes.shapeOutstandingSuppliersRows(bills);
}

export async function buildUnknownPaymentsRows(companyId: string): Promise<shapes.UnknownPaymentRow[]> {
  const transactions = await repo.listBankTransactions(companyId);
  return shapes.shapeUnknownPaymentsRows(transactions);
}

export async function buildDuplicatePaymentsRows(companyId: string): Promise<shapes.DuplicatePaymentRow[]> {
  const [transactions, bills] = await Promise.all([repo.listBankTransactions(companyId), repo.listAllBills(companyId)]);
  return shapes.shapeDuplicatePaymentsRows(transactions, bills);
}
