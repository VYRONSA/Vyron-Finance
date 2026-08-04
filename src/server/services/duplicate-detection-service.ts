/**
 * Duplicate Detection — fetches real data for every entity type the
 * Matching Platform directive names, hands it to the pure composition
 * core (`duplicate-detection-engine.ts::buildDuplicateFindings`), then
 * applies the Permanent Ignore filter. See that file's own docstring for
 * why the pure logic lives there (Preview Mode's mock data reuses it
 * unchanged).
 *
 * Manual Override and Permanent Ignore Rule are both persisted via the
 * shared, intentionally generic `matching_overrides` table (see that
 * migration's own "every override shape is structurally the same"
 * comment) — no new table. "Ignore" (dismiss for the current session
 * only) is deliberately NOT persisted — see `duplicate-detection-tab.tsx`
 * for that ephemeral UI-only action.
 */

import { listCustomers } from "@/server/services/customer-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listMerchants } from "@/server/services/merchant-service";
import { listStockItems } from "@/server/services/stock-item-service";
import { listTransactionsForExport } from "@/server/services/transaction-explorer-service";
import type { TransactionExplorerFilters } from "@/server/accounting/types";
import { listSalesOrders } from "@/server/services/sales-order-service";
import { listPurchaseOrders } from "@/server/services/purchase-order-service";
import { listQuotations } from "@/server/services/quotation-service";
import { listAllBills } from "@/server/services/purchase-bill-service";
import { listSupplierPayments } from "@/server/services/supplier-payment-service";
import { listCustomerReceipts } from "@/server/services/customer-receipt-service";
import { listGlTransactionsInRange } from "@/server/repositories/gl-repository";
import { recordOverride, listRecentOverrides } from "@/server/repositories/matching-override-repository";
import { buildDuplicateFindings, DUPLICATE_IGNORE_ITEM_TYPE, type DuplicateEntityType, type DuplicateFinding } from "@/server/matching/duplicate-detection-engine";

export type { DuplicateEntityType, DuplicateFinding };

const DEFAULT_TRANSACTION_FILTERS: TransactionExplorerFilters = {
  search: null, dateFrom: null, dateTo: null, minAmount: null, maxAmount: null,
  statuses: null, bankAccountId: null, importBatch: null, duplicateOnly: false,
  unknownSupplierOnly: false, sortBy: "transactionDate", sortDirection: "desc",
};

/** Every finding, across every entity type, with any Permanently
 * Ignored (entityType, relatedId) pair already filtered out. */
export async function getDuplicateFindings(companyId: string, referenceDateIso: string): Promise<DuplicateFinding[]> {
  const glFrom = new Date(new Date(referenceDateIso).getTime() - 90 * 86_400_000).toISOString().slice(0, 10);

  const [customers, suppliers, merchants, stockItems, transactionsResult, salesOrders, purchaseOrders, quotations, bills, payments, receipts, glResult, ignoredOverrides] = await Promise.all([
    listCustomers(companyId),
    listSuppliers(companyId),
    listMerchants(companyId),
    listStockItems(companyId),
    listTransactionsForExport(companyId, DEFAULT_TRANSACTION_FILTERS),
    listSalesOrders(companyId),
    listPurchaseOrders(companyId),
    listQuotations(companyId),
    listAllBills(companyId),
    listSupplierPayments(companyId),
    listCustomerReceipts(companyId),
    listGlTransactionsInRange(companyId, glFrom, referenceDateIso),
    listRecentOverrides(companyId, 1000),
  ]);

  const findings = buildDuplicateFindings(companyId, {
    customers, suppliers, merchants, stockItems,
    transactions: transactionsResult.transactions,
    salesOrders, purchaseOrders, quotations, bills, payments, receipts,
    glTransactions: glResult.transactions,
  });

  const ignored = new Set(ignoredOverrides.filter((o) => o.fieldName === "permanentIgnore").map((o) => `${o.itemType}:${o.itemId}`));
  return findings.filter((f) => !ignored.has(`${DUPLICATE_IGNORE_ITEM_TYPE(f.entityType)}:${f.relatedId}`));
}

/** Manual Override — a persisted audit note attached to this specific
 * finding (who reviewed it, and why); does NOT suppress future
 * detection runs — a lighter action than a Permanent Ignore Rule. */
export async function recordManualOverride(companyId: string, entityType: DuplicateEntityType, relatedId: number, reason: string, performedBy: string): Promise<void> {
  await recordOverride(companyId, {
    itemType: `Duplicate:${entityType}`,
    itemId: relatedId,
    fieldName: "manualReview",
    oldValue: null,
    newValue: "Reviewed",
    reason,
    performedBy,
  });
}

/** Permanent Ignore Rule — persisted, and filtered out of every future
 * `getDuplicateFindings` call for this exact (entityType, relatedId). */
export async function recordPermanentIgnore(companyId: string, entityType: DuplicateEntityType, relatedId: number, reason: string, performedBy: string): Promise<void> {
  await recordOverride(companyId, {
    itemType: DUPLICATE_IGNORE_ITEM_TYPE(entityType),
    itemId: relatedId,
    fieldName: "permanentIgnore",
    oldValue: null,
    newValue: "Ignored",
    reason,
    performedBy,
  });
}
