/**
 * Pure composition core for Duplicate Detection — takes already-fetched
 * entity arrays and returns every finding across all 12 entity types.
 * Split from `duplicate-detection-service.ts` (which only fetches the
 * data and applies the Permanent Ignore filter) so this same logic can
 * be reused, unchanged, by Preview Mode's mock data — the same
 * pure-core/async-wrapper split `matching-summary-service.ts::buildMatchingSummary`
 * already established.
 */

import { runDuplicatePaymentsTest, runDuplicateJournalsTest } from "@/server/audit/audit-tests-engine";
import { findDuplicateParties } from "@/server/matching/duplicate-party-engine";
import { findDuplicateDocuments, type DuplicatableDocument } from "@/server/matching/duplicate-document-engine";
import type { Customer } from "@/server/customer-management/types";
import type { Supplier, BankTransactionRecord, ImportedBill } from "@/server/accounting/types";
import type { Merchant } from "@/server/banking-rules/types";
import type { StockItem } from "@/server/inventory/types";
import type { SalesOrder, Quotation, CustomerReceipt } from "@/server/sales/types";
import type { PurchaseOrder, SupplierPayment } from "@/server/purchasing/types";
import type { GlTransactionWithContext } from "@/server/general-ledger/types";

export type DuplicateEntityType =
  | "Customer" | "Supplier" | "Merchant" | "InventoryItem"
  | "Transaction" | "SalesOrder" | "PurchaseOrder" | "Quotation"
  | "Bill" | "Payment" | "Receipt" | "Journal";

export type DuplicateFinding = {
  id: string;
  entityType: DuplicateEntityType;
  relatedId: number;
  /** Every ID in this finding's duplicate group, `relatedId` included —
   * the real data "Suggested Merge" needs to pick a genuine, distinct
   * merge target. Empty for entity types with no group concept (e.g.
   * document-based duplicates, which are pairwise, not grouped, and
   * don't support merge at all). */
  groupIds: number[];
  confidence: number;
  reason: string;
  evidence: string;
  detailHref: string;
  supportsMerge: boolean;
};

export const MERGE_SUPPORTED_ENTITY_TYPES: Set<DuplicateEntityType> = new Set(["Customer", "Supplier", "Merchant"]);

export const DUPLICATE_IGNORE_ITEM_TYPE = (entityType: DuplicateEntityType) => `DuplicateIgnore:${entityType}`;

function toFinding(entityType: DuplicateEntityType, relatedId: number, confidence: number, reason: string, evidence: string, detailHref: string, groupIds: number[] = []): DuplicateFinding {
  return { id: `${entityType}:${relatedId}`, entityType, relatedId, groupIds, confidence, reason, evidence, detailHref, supportsMerge: MERGE_SUPPORTED_ENTITY_TYPES.has(entityType) };
}

function sumLines(lines: { lineTotal: number }[]): number {
  return lines.reduce((sum, l) => sum + l.lineTotal, 0);
}

export type DuplicateDetectionInputs = {
  customers: Customer[];
  suppliers: Supplier[];
  merchants: Merchant[];
  stockItems: StockItem[];
  transactions: BankTransactionRecord[];
  salesOrders: SalesOrder[];
  purchaseOrders: PurchaseOrder[];
  quotations: Quotation[];
  bills: ImportedBill[];
  payments: SupplierPayment[];
  receipts: CustomerReceipt[];
  glTransactions: GlTransactionWithContext[];
};

export function buildDuplicateFindings(companyId: string, inputs: DuplicateDetectionInputs): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];

  // Customer/Supplier duplicate detection calls the shared engine
  // directly (not via `runDuplicateCustomersTest`/`runDuplicateSuppliersTest`'s
  // Auditor-Workspace-shaped wrapper) specifically to keep `groupIds` —
  // the wrapper's `AuditTestFinding` shape has no group concept, which
  // is exactly why "Suggested Merge" was previously unfixable: it never
  // had a real, distinct merge target to submit. See docs/DEFECT_REGISTER.md D-026.
  for (const f of findDuplicateParties(inputs.customers.map((c) => ({ id: c.id, name: c.name, secondaryIds: [c.vatNumber ?? "", c.registrationNumber ?? ""].filter(Boolean) })))) {
    findings.push(toFinding("Customer", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/customers`, f.groupIds));
  }
  for (const f of findDuplicateParties(inputs.suppliers.map((s) => ({ id: s.id, name: s.name, secondaryIds: [s.bankAccountNumber ?? "", s.vatNumber ?? ""].filter(Boolean) })))) {
    findings.push(toFinding("Supplier", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/suppliers`, f.groupIds));
  }
  for (const f of findDuplicateParties(inputs.merchants.map((m) => ({ id: m.id, name: m.name, secondaryIds: [] })))) {
    findings.push(toFinding("Merchant", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/matching?tab=merchant-matching`, f.groupIds));
  }
  for (const f of findDuplicateParties(inputs.stockItems.map((s) => ({ id: s.id, name: s.description, secondaryIds: [s.stockCode, s.barcode].filter(Boolean) })))) {
    findings.push(toFinding("InventoryItem", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/inventory`, f.groupIds));
  }
  for (const f of runDuplicatePaymentsTest(inputs.transactions.map((t) => ({ id: t.id, transactionDate: t.transactionDate, debit: t.debit, credit: t.credit, beneficiary: t.beneficiary })))) {
    if (f.relatedId !== null) findings.push(toFinding("Transaction", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/transactions?transaction=${f.relatedId}`));
  }
  for (const f of runDuplicateJournalsTest(inputs.glTransactions)) {
    if (f.relatedId !== null) findings.push(toFinding("Journal", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/general-ledger?tab=journals`));
  }

  const salesOrderDocs: DuplicatableDocument[] = inputs.salesOrders.map((o) => ({ id: o.id, partyId: o.customerId, amount: sumLines(o.lines), date: o.orderDate, reference: o.orderNumber }));
  for (const f of findDuplicateDocuments(salesOrderDocs)) {
    findings.push(toFinding("SalesOrder", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/sales?tab=orders`));
  }

  const purchaseOrderDocs: DuplicatableDocument[] = inputs.purchaseOrders.map((o) => ({ id: o.id, partyId: o.supplierId, amount: sumLines(o.lines), date: o.orderDate, reference: o.orderNumber }));
  for (const f of findDuplicateDocuments(purchaseOrderDocs)) {
    findings.push(toFinding("PurchaseOrder", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/purchasing?tab=orders`));
  }

  const quotationDocs: DuplicatableDocument[] = inputs.quotations.map((q) => ({ id: q.id, partyId: q.customerId, amount: sumLines(q.lines), date: q.quotationDate, reference: q.quotationNumber }));
  for (const f of findDuplicateDocuments(quotationDocs)) {
    findings.push(toFinding("Quotation", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/sales?tab=quotations`));
  }

  const billDocs: DuplicatableDocument[] = inputs.bills.map((b) => ({ id: b.id, partyId: b.supplierId, amount: b.total, date: b.invoiceDate, reference: b.invoiceNumber }));
  for (const f of findDuplicateDocuments(billDocs)) {
    findings.push(toFinding("Bill", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/purchasing?tab=bills`));
  }

  const paymentDocs: DuplicatableDocument[] = inputs.payments.map((p) => ({ id: p.id, partyId: p.supplierId, amount: p.amount, date: p.paymentDate, reference: p.reference }));
  for (const f of findDuplicateDocuments(paymentDocs)) {
    findings.push(toFinding("Payment", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/purchasing?tab=payments`));
  }

  const receiptDocs: DuplicatableDocument[] = inputs.receipts.map((r) => ({ id: r.id, partyId: r.customerId, amount: r.amount, date: r.receiptDate, reference: r.reference }));
  for (const f of findDuplicateDocuments(receiptDocs)) {
    findings.push(toFinding("Receipt", f.relatedId, f.confidence, f.reason, f.evidence, `/company/${companyId}/sales?tab=receipts`));
  }

  return findings;
}
