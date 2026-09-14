/**
 * Preview Mode's `ReportDataSource` — the existing Preview Mode mock
 * datasets, served through the same in-memory source the tests use, so
 * every report renders (and every reconciliation check runs) against the
 * sample data exactly as it would against a live company. The Trial
 * Balance is derived from the mock GL lines by `trialBalanceFromGl`, not
 * hand-typed.
 */

import { MOCK_CHART_OF_ACCOUNTS, MOCK_GL_TRANSACTIONS, MOCK_JOURNALS } from "@/lib/mock/general-ledger-data";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { MOCK_CUSTOMER_RECEIPTS, MOCK_QUOTATIONS, MOCK_SALES_INVOICES, MOCK_SALES_ORDERS } from "@/lib/mock/sales-data";
import { MOCK_PURCHASE_BILLS, MOCK_PURCHASE_ORDERS, MOCK_SUPPLIER_PAYMENTS } from "@/lib/mock/purchasing-data";
import { MOCK_TRANSACTIONS } from "@/lib/mock/transaction-explorer-data";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";
import { MOCK_BANK_RECONCILIATIONS } from "@/lib/mock/cashbook-data";
import { MOCK_IMPORT_BATCHES } from "@/lib/mock/import-centre-data";
import { MOCK_COMPANIES_FULL, MOCK_FINANCIAL_YEARS, MOCK_VAT_TREATMENTS } from "@/lib/mock/company-management-data";
import { MOCK_VAT_ADJUSTMENTS, MOCK_VAT_RETURNS } from "@/lib/mock/vat-data";
import { MOCK_INVENTORY_TRANSACTIONS, MOCK_STOCK_ITEMS } from "@/lib/mock/inventory-data";
import { MOCK_BUDGETS } from "@/lib/mock/financial-reporting-data";
import { MOCK_COMPANY } from "@/lib/mock/financial-data";
import { resolveVatAccounts } from "./control-accounts";
import { createInMemorySource, type ReportDataSource } from "./source";

export function createPreviewSource(companyId: string): ReportDataSource {
  const company = MOCK_COMPANIES_FULL.find((c) => c.id === MOCK_COMPANY.id);
  return createInMemorySource({
    company: {
      id: companyId,
      name: MOCK_COMPANY.name,
      financialYearStartMonth: company?.financialYearStartMonth ?? 3,
      currencyCode: company?.baseCurrencyCode || "ZAR",
    },
    financialYears: MOCK_FINANCIAL_YEARS,
    accounts: MOCK_CHART_OF_ACCOUNTS,
    // The seeded default posting rules settle subsidiary ledgers against
    // Debtors (1100) and Creditors (2000) — migration 0007.
    controlAccounts: { debtors: "1100", creditors: "2000", vat: resolveVatAccounts(MOCK_CHART_OF_ACCOUNTS) },
    gl: MOCK_GL_TRANSACTIONS,
    journals: MOCK_JOURNALS,
    customers: MOCK_CUSTOMERS,
    suppliers: MOCK_SUPPLIERS,
    salesInvoices: MOCK_SALES_INVOICES,
    customerReceipts: MOCK_CUSTOMER_RECEIPTS,
    quotations: MOCK_QUOTATIONS,
    salesOrders: MOCK_SALES_ORDERS,
    bills: MOCK_PURCHASE_BILLS,
    supplierPayments: MOCK_SUPPLIER_PAYMENTS,
    purchaseOrders: MOCK_PURCHASE_ORDERS,
    bankAccounts: MOCK_BANK_ACCOUNT_SUMMARIES.map((s) => s.account),
    bankTransactions: MOCK_TRANSACTIONS,
    bankReconciliations: MOCK_BANK_RECONCILIATIONS,
    importBatches: MOCK_IMPORT_BATCHES,
    vatTreatments: MOCK_VAT_TREATMENTS,
    vatReturns: MOCK_VAT_RETURNS,
    vatAdjustments: MOCK_VAT_ADJUSTMENTS,
    stockItems: MOCK_STOCK_ITEMS,
    inventoryTransactions: MOCK_INVENTORY_TRANSACTIONS,
    budgets: MOCK_BUDGETS,
  });
}
