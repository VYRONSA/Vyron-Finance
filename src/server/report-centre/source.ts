/**
 * The Reporting Centre's data contract.
 *
 * Reports never talk to Supabase, repositories, or mocks directly — they
 * read through a `ReportDataSource`. Three implementations share this one
 * interface, so a report's arithmetic is exactly the same code in every
 * environment:
 *   - `production-source.ts` — the existing repositories/services (the
 *     same read paths every other module already uses), server-only.
 *   - `preview-source.ts` — Preview Mode's mock data.
 *   - `createInMemorySource` below — test fixtures with known totals.
 *
 * Every method is a READ. `memoizeSource` makes each distinct read happen
 * at most once per report run, so a report that asks for the Trial
 * Balance at the same date three times costs one query.
 */

import { trialBalanceRowFromRpcRow } from "@/server/general-ledger/mappers";
import { compareGlAccountCodes } from "@/server/general-ledger/types";
import type { ChartOfAccount, GlTransactionWithContext, TrialBalanceRow } from "@/server/general-ledger/types";
import type { AllocationHistoryEntry, BankAccount, BankTransactionRecord, ImportBatch, ImportedBill, Journal, PurchaseBillLine, Supplier } from "@/server/accounting/types";
import type { Customer } from "@/server/customer-management/types";
import type { CustomerReceipt, Quotation, SalesInvoice, SalesOrder } from "@/server/sales/types";
import type { PurchaseOrder, SupplierPayment } from "@/server/purchasing/types";
import type { FinancialYear, VatTreatment } from "@/server/company-management/types";
import type { VatAdjustment, VatReturn } from "@/server/vat/types";
import type { BankReconciliation } from "@/server/banking/types";
import type { OpeningBalanceEntry } from "@/server/opening-balances/types";
import type { InventoryTransaction, StockItem } from "@/server/inventory/types";
import type { Budget } from "@/server/reporting/types";

export type ReportCompany = {
  id: string;
  name: string;
  financialYearStartMonth: number;
  currencyCode: string;
};

export type VatAccountRole = "Input" | "Output" | "Control";
export type VatAccountRef = { accountId: number; accountCode: string; description: string; role: VatAccountRole };

/** The GL accounts the company's own posting rules settle subsidiary
 * ledgers and VAT against. Resolved from the company's configuration,
 * never assumed — `null`/empty when a company genuinely has none
 * configured, and the reports that need one say so. */
export type ControlAccounts = {
  debtors: string | null;
  creditors: string | null;
  vat: VatAccountRef[];
};

export type DateWindow = { from?: string; to?: string };

export type CappedList<T> = { items: T[]; truncated: boolean };

export interface ReportDataSource {
  company(): Promise<ReportCompany>;
  financialYears(): Promise<FinancialYear[]>;
  accounts(): Promise<ChartOfAccount[]>;
  controlAccounts(): Promise<ControlAccounts>;
  /** `fn_trial_balance` semantics: every ACTIVE account, cumulative to
   * `asOf` inclusive (all-time when null). */
  trialBalance(asOf: string | null): Promise<TrialBalanceRow[]>;
  /** Posted GL lines in the window, ascending by date then id. */
  glTransactions(window: DateWindow & { accountId?: number }): Promise<CappedList<GlTransactionWithContext>>;
  journals(): Promise<Journal[]>;
  customers(): Promise<Customer[]>;
  suppliers(): Promise<Supplier[]>;
  salesInvoices(): Promise<SalesInvoice[]>;
  customerReceipts(): Promise<CustomerReceipt[]>;
  quotations(): Promise<Quotation[]>;
  salesOrders(): Promise<SalesOrder[]>;
  bills(): Promise<ImportedBill[]>;
  billLines(): Promise<PurchaseBillLine[]>;
  supplierPayments(): Promise<SupplierPayment[]>;
  purchaseOrders(): Promise<PurchaseOrder[]>;
  bankAccounts(): Promise<BankAccount[]>;
  /** Bank transactions whose transaction date falls in the window. */
  bankTransactions(window: DateWindow): Promise<CappedList<BankTransactionRecord>>;
  bankReconciliations(): Promise<BankReconciliation[]>;
  importBatches(): Promise<ImportBatch[]>;
  allocationHistory(window: DateWindow): Promise<CappedList<AllocationHistoryEntry>>;
  openingBalances(): Promise<OpeningBalanceEntry[]>;
  vatTreatments(): Promise<VatTreatment[]>;
  vatReturns(): Promise<VatReturn[]>;
  vatAdjustments(): Promise<VatAdjustment[]>;
  stockItems(): Promise<StockItem[]>;
  inventoryTransactions(): Promise<InventoryTransaction[]>;
  budgets(): Promise<Budget[]>;
}

/** Wraps a source so each distinct read (method + arguments) is issued
 * once per report run. */
export function memoizeSource(source: ReportDataSource): ReportDataSource {
  const cache = new Map<string, Promise<unknown>>();
  return new Proxy(source, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const key = `${String(prop)}:${JSON.stringify(args)}`;
        let pending = cache.get(key);
        if (!pending) {
          pending = (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          // A failed read must not poison a later attempt in the same run.
          pending.catch(() => cache.delete(key));
          cache.set(key, pending);
        }
        return pending;
      };
    },
  });
}

/** `fn_trial_balance`, reproduced in memory over GL lines: every active
 * account, cumulative debit/credit to `asOf`, mapped through the SAME
 * production mapper the RPC result goes through. */
export function trialBalanceFromGl(
  accounts: ChartOfAccount[],
  gl: Pick<GlTransactionWithContext, "accountId" | "postingDate" | "debit" | "credit">[],
  asOf: string | null,
): TrialBalanceRow[] {
  const totals = new Map<number, { debit: number; credit: number }>();
  for (const line of gl) {
    if (asOf && line.postingDate > asOf) continue;
    const t = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
    t.debit += line.debit;
    t.credit += line.credit;
    totals.set(line.accountId, t);
  }
  return accounts
    .filter((a) => a.isActive)
    .sort((a, b) => compareGlAccountCodes(a.accountCode, b.accountCode))
    .map((a) => {
      const t = totals.get(a.id) ?? { debit: 0, credit: 0 };
      return trialBalanceRowFromRpcRow({
        account_id: a.id,
        account_code: a.accountCode,
        description: a.description,
        account_type: a.accountType,
        normal_balance: a.normalBalance,
        total_debit: Math.round(t.debit * 100) / 100,
        total_credit: Math.round(t.credit * 100) / 100,
      });
    });
}

export type InMemoryData = {
  company: ReportCompany;
  financialYears?: FinancialYear[];
  accounts?: ChartOfAccount[];
  controlAccounts?: ControlAccounts;
  gl?: GlTransactionWithContext[];
  journals?: Journal[];
  customers?: Customer[];
  suppliers?: Supplier[];
  salesInvoices?: SalesInvoice[];
  customerReceipts?: CustomerReceipt[];
  quotations?: Quotation[];
  salesOrders?: SalesOrder[];
  bills?: ImportedBill[];
  billLines?: PurchaseBillLine[];
  supplierPayments?: SupplierPayment[];
  purchaseOrders?: PurchaseOrder[];
  bankAccounts?: BankAccount[];
  bankTransactions?: BankTransactionRecord[];
  bankReconciliations?: BankReconciliation[];
  importBatches?: ImportBatch[];
  allocationHistory?: AllocationHistoryEntry[];
  openingBalances?: OpeningBalanceEntry[];
  vatTreatments?: VatTreatment[];
  vatReturns?: VatReturn[];
  vatAdjustments?: VatAdjustment[];
  stockItems?: StockItem[];
  inventoryTransactions?: InventoryTransaction[];
  budgets?: Budget[];
};

function within(date: string | null | undefined, window: DateWindow): boolean {
  if (!window.from && !window.to) return true;
  if (!date) return false;
  const d = date.slice(0, 10);
  return (!window.from || d >= window.from) && (!window.to || d <= window.to);
}

function byDateThenId<T extends { id: number }>(date: (item: T) => string | null) {
  return (a: T, b: T) => {
    const da = date(a) ?? "";
    const db = date(b) ?? "";
    return da === db ? a.id - b.id : da < db ? -1 : 1;
  };
}

export function createInMemorySource(data: InMemoryData): ReportDataSource {
  const accounts = data.accounts ?? [];
  const gl = [...(data.gl ?? [])].sort(byDateThenId((t) => t.postingDate));
  const bankTransactions = [...(data.bankTransactions ?? [])].sort(byDateThenId((t) => t.transactionDate));
  const resolved = <T>(value: T) => Promise.resolve(value);
  return {
    company: () => resolved(data.company),
    financialYears: () => resolved(data.financialYears ?? []),
    accounts: () => resolved(accounts),
    controlAccounts: () => resolved(data.controlAccounts ?? { debtors: null, creditors: null, vat: [] }),
    trialBalance: (asOf) => resolved(trialBalanceFromGl(accounts, gl, asOf)),
    glTransactions: (window) =>
      resolved({ items: gl.filter((t) => within(t.postingDate, window) && (window.accountId === undefined || t.accountId === window.accountId)), truncated: false }),
    journals: () => resolved(data.journals ?? []),
    customers: () => resolved(data.customers ?? []),
    suppliers: () => resolved(data.suppliers ?? []),
    salesInvoices: () => resolved(data.salesInvoices ?? []),
    customerReceipts: () => resolved(data.customerReceipts ?? []),
    quotations: () => resolved(data.quotations ?? []),
    salesOrders: () => resolved(data.salesOrders ?? []),
    bills: () => resolved(data.bills ?? []),
    billLines: () => resolved(data.billLines ?? []),
    supplierPayments: () => resolved(data.supplierPayments ?? []),
    purchaseOrders: () => resolved(data.purchaseOrders ?? []),
    bankAccounts: () => resolved(data.bankAccounts ?? []),
    bankTransactions: (window) => resolved({ items: bankTransactions.filter((t) => within(t.transactionDate, window)), truncated: false }),
    bankReconciliations: () => resolved(data.bankReconciliations ?? []),
    importBatches: () => resolved(data.importBatches ?? []),
    allocationHistory: (window) => resolved({ items: (data.allocationHistory ?? []).filter((h) => within(h.createdAt, window)), truncated: false }),
    openingBalances: () => resolved(data.openingBalances ?? []),
    vatTreatments: () => resolved(data.vatTreatments ?? []),
    vatReturns: () => resolved(data.vatReturns ?? []),
    vatAdjustments: () => resolved(data.vatAdjustments ?? []),
    stockItems: () => resolved(data.stockItems ?? []),
    inventoryTransactions: () => resolved(data.inventoryTransactions ?? []),
    budgets: () => resolved(data.budgets ?? []),
  };
}
