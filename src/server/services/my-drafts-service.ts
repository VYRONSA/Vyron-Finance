/**
 * Master Implementation Tracker — Epic E11, Finding #223 (RC-9). "My
 * Drafts" — one place to see every Draft-status document across GL,
 * Sales, Purchasing, and Cashbook, since today each module's Draft
 * items are only visible by opening that module and filtering. Every
 * status union in this codebase uses the literal `"Draft"` as its
 * first member (see the RC-9 investigation notes), so one filter value
 * works unchanged across every module.
 */

import * as journalRepo from "@/server/repositories/journal-repository";
import * as quotationRepo from "@/server/repositories/quotation-repository";
import * as salesOrderRepo from "@/server/repositories/sales-order-repository";
import * as purchaseRequisitionRepo from "@/server/repositories/purchase-requisition-repository";
import * as purchaseOrderRepo from "@/server/repositories/purchase-order-repository";
import * as cashbookRepo from "@/server/repositories/cashbook-repository";
import type { Journal } from "@/server/accounting/types";
import type { Quotation, SalesOrder } from "@/server/sales/types";
import type { PurchaseRequisition, PurchaseOrder } from "@/server/purchasing/types";
import type { CashbookBatch } from "@/server/banking/types";

export type MyDraftModule = "General Ledger" | "Sales" | "Purchasing" | "Cashbook";

export type MyDraftItem = {
  module: MyDraftModule;
  documentType: string;
  id: number;
  number: string;
  date: string;
  description: string;
  href: string;
};

/** Pure — the fetch-then-filter-then-sort decision logic, separated
 * from the six repository calls so it's directly testable with plain
 * fixtures (this codebase's established pure/orchestration split). */
export function buildMyDraftsList(
  companyId: string,
  data: {
    journals: Journal[];
    quotations: Quotation[];
    salesOrders: SalesOrder[];
    requisitions: PurchaseRequisition[];
    purchaseOrders: PurchaseOrder[];
    cashbookBatches: CashbookBatch[];
  },
): MyDraftItem[] {
  const items: MyDraftItem[] = [
    ...data.journals
      .filter((j) => j.status === "Draft")
      .map((j) => ({ module: "General Ledger" as const, documentType: "Journal", id: j.id, number: j.journalNumber, date: j.journalDate, description: j.description, href: `/company/${companyId}/general-ledger?tab=journals&journal=${j.journalNumber}` })),
    ...data.quotations
      .filter((q) => q.status === "Draft")
      .map((q) => ({ module: "Sales" as const, documentType: "Quotation", id: q.id, number: q.quotationNumber, date: q.quotationDate, description: q.notes, href: `/company/${companyId}/sales?tab=quotations` })),
    ...data.salesOrders
      .filter((o) => o.status === "Draft")
      .map((o) => ({ module: "Sales" as const, documentType: "Sales Order", id: o.id, number: o.orderNumber, date: o.orderDate, description: o.notes, href: `/company/${companyId}/sales?tab=orders` })),
    ...data.requisitions
      .filter((r) => r.status === "Draft")
      .map((r) => ({ module: "Purchasing" as const, documentType: "Purchase Requisition", id: r.id, number: r.requisitionNumber, date: r.requisitionDate, description: r.notes, href: `/company/${companyId}/purchasing?tab=requisitions` })),
    ...data.purchaseOrders
      .filter((o) => o.status === "Draft")
      .map((o) => ({ module: "Purchasing" as const, documentType: "Purchase Order", id: o.id, number: o.orderNumber, date: o.orderDate, description: o.notes, href: `/company/${companyId}/purchasing?tab=orders` })),
    ...data.cashbookBatches
      .filter((b) => b.status === "Draft")
      .map((b) => ({ module: "Cashbook" as const, documentType: "Cashbook Batch", id: b.id, number: b.batchNumber, date: b.batchDate, description: b.notes, href: `/company/${companyId}/cashbook?tab=batch-capture` })),
  ];

  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function listMyDrafts(companyId: string): Promise<MyDraftItem[]> {
  const [journals, quotations, salesOrders, requisitions, purchaseOrders, cashbookBatches] = await Promise.all([
    journalRepo.listJournalsByStatus(companyId, "Draft"),
    quotationRepo.listQuotations(companyId),
    salesOrderRepo.listSalesOrders(companyId),
    purchaseRequisitionRepo.listPurchaseRequisitions(companyId),
    purchaseOrderRepo.listPurchaseOrders(companyId),
    cashbookRepo.listCashbookBatches(companyId),
  ]);

  return buildMyDraftsList(companyId, { journals, quotations, salesOrders, requisitions, purchaseOrders, cashbookBatches });
}
