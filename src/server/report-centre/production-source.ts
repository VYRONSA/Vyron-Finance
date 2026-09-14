/**
 * The production `ReportDataSource` — every read goes through an existing
 * repository/service (the same read paths the rest of VYRON uses) or
 * through `report-centre-repository.ts`'s complete, paged reads of the
 * same tables with the same mappers. Server-only: it uses the request's
 * own Supabase session, so Row Level Security still scopes every row to
 * the signed-in user's company.
 */

import * as reads from "@/server/repositories/report-centre-repository";
import { getCompany } from "@/server/services/company-service";
import { listFinancialYears } from "@/server/repositories/financial-year-repository";
import { listChartOfAccounts } from "@/server/repositories/chart-of-accounts-repository";
import { getTrialBalanceRows } from "@/server/repositories/gl-repository";
import { getPostingRuleByEventType } from "@/server/repositories/posting-rule-repository";
import { controlAccountFromRule } from "@/server/services/bank-posting-service";
import { listBankAccounts } from "@/server/repositories/bank-account-repository";
import { listReconciliations } from "@/server/repositories/bank-reconciliation-repository";
import { listRecentImportBatches } from "@/server/repositories/import-repository";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { listVatReturns } from "@/server/repositories/vat-return-repository";
import { listVatAdjustments } from "@/server/repositories/vat-adjustment-repository";
import { listBudgets } from "@/server/repositories/budget-repository";
import { resolveVatAccounts } from "./control-accounts";
import { memoizeSource, type ReportDataSource } from "./source";

/** Import batches are few per company; this is the existing function's
 * own page ceiling. */
const IMPORT_BATCH_LIMIT = 1000;

export function createProductionSource(companyId: string): ReportDataSource {
  const source: ReportDataSource = {
    async company() {
      const company = await getCompany(companyId);
      if (!company) throw new Error("Company not found.");
      return { id: company.id, name: company.name, financialYearStartMonth: company.financialYearStartMonth, currencyCode: company.baseCurrencyCode || "ZAR" };
    },
    financialYears: () => listFinancialYears(companyId),
    accounts: () => listChartOfAccounts(companyId),
    async controlAccounts() {
      const [supplierPaymentRule, customerReceiptRule, accounts] = await Promise.all([
        getPostingRuleByEventType(companyId, "Supplier Payment"),
        getPostingRuleByEventType(companyId, "Customer Receipt"),
        listChartOfAccounts(companyId),
      ]);
      // The same resolution `bank-posting-service.ts` uses to post
      // subsidiary-ledger settlements — so the report reconciles against
      // the account the money was actually posted to.
      return {
        creditors: controlAccountFromRule(supplierPaymentRule, "creditors"),
        debtors: controlAccountFromRule(customerReceiptRule, "debtors"),
        vat: resolveVatAccounts(accounts),
      };
    },
    trialBalance: (asOf) => getTrialBalanceRows(companyId, asOf),
    glTransactions: (window) => reads.readGlTransactions(companyId, window),
    journals: async () => (await reads.readJournals(companyId)).items,
    customers: async () => (await reads.readCustomers(companyId)).items,
    suppliers: async () => (await reads.readSuppliers(companyId)).items,
    salesInvoices: async () => (await reads.readSalesInvoices(companyId)).items,
    customerReceipts: async () => (await reads.readCustomerReceipts(companyId)).items,
    quotations: async () => (await reads.readQuotations(companyId)).items,
    salesOrders: async () => (await reads.readSalesOrders(companyId)).items,
    bills: async () => (await reads.readBills(companyId)).items,
    billLines: async () => (await reads.readBillLines(companyId)).items,
    supplierPayments: async () => (await reads.readSupplierPayments(companyId)).items,
    purchaseOrders: async () => (await reads.readPurchaseOrders(companyId)).items,
    bankAccounts: () => listBankAccounts(companyId),
    bankTransactions: (window) => reads.readBankTransactions(companyId, window),
    bankReconciliations: () => listReconciliations(companyId),
    importBatches: () => listRecentImportBatches(companyId, IMPORT_BATCH_LIMIT),
    allocationHistory: (window) => reads.readAllocationHistory(companyId, window),
    openingBalances: async () => (await reads.readOpeningBalances(companyId)).items,
    vatTreatments: () => listVatTreatments(companyId),
    vatReturns: () => listVatReturns(companyId),
    vatAdjustments: () => listVatAdjustments(companyId),
    stockItems: async () => (await reads.readStockItems(companyId)).items,
    inventoryTransactions: async () => (await reads.readInventoryTransactions(companyId)).items,
    budgets: () => listBudgets(companyId),
  };
  return memoizeSource(source);
}
