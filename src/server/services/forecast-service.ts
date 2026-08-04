/**
 * Per-forecast-type callers over the ONE `linearRegressionForecast`
 * engine (`server/reporting/forecast-engine.ts`) — Cashflow/Revenue/
 * Expense/VAT/Inventory reuse the same "diff Trial Balance snapshots at
 * successive month-ends" technique `financial-statements-service.ts`
 * already established (one real account, real monthly balances — no
 * second GL query path); Customer/Supplier Payment forecasts reuse each
 * domain's own already-built `computeAveragePaymentDays`, bucketed by
 * month, rather than a new payment-behaviour calculation.
 */

import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { getIncomeStatement } from "@/server/services/financial-statements-service";
import { listSalesInvoices } from "@/server/repositories/sales-invoice-repository";
import { listCustomerReceipts } from "@/server/repositories/customer-receipt-repository";
import { computeAveragePaymentDays as computeCustomerAveragePaymentDays } from "@/server/services/customer-financial-service";
import { listPurchaseBills } from "@/server/repositories/purchase-bill-repository";
import { listSupplierPayments } from "@/server/repositories/supplier-payment-repository";
import { computeAveragePaymentDays as computeSupplierAveragePaymentDays } from "@/server/services/supplier-financial-service";
import { linearRegressionForecast, type ForecastResult } from "@/server/reporting/forecast-engine";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Pure — the last `n` complete calendar month-ends before `referenceDate`,
 * oldest first (e.g. n=6 as of 2026-08-15 -> Feb..Jul 2026 month-ends). */
export function lastNMonthEnds(n: number, referenceDate: string): string[] {
  const ref = new Date(`${referenceDate}T00:00:00Z`);
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth();
  const result: string[] = [];
  for (let k = n; k >= 1; k--) {
    result.push(new Date(Date.UTC(year, month - k + 1, 0)).toISOString().slice(0, 10));
  }
  return result;
}

/** Pure — the label for the Nth month after the last historical
 * month-end in `monthEnds`. */
function monthLabelAfter(monthEnds: string[], indexAfterLastKnown: number): string {
  const last = monthEnds.length > 0 ? new Date(`${monthEnds[monthEnds.length - 1]}T00:00:00Z`) : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const d = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1 + indexAfterLastKnown, 0));
  return d.toISOString().slice(0, 7); // "YYYY-MM"
}

async function monthlyAccountBalanceSeries(companyId: string, accountCode: string, monthEnds: string[], creditPositive: boolean) {
  const accounts = await listChartOfAccounts(companyId);
  const account = accounts.find((a) => a.accountCode === accountCode);
  if (!account) return [];

  const balances = await Promise.all(monthEnds.map((asOfDate) => getTrialBalance(companyId, asOfDate)));
  return monthEnds.map((period, i) => {
    const row = balances[i].rows.find((r) => r.accountId === account.id);
    const amount = row ? (creditPositive ? row.creditBalance - row.debitBalance : row.debitBalance - row.creditBalance) : 0;
    return { period, value: round2(amount) };
  });
}

const MONTHS_OF_HISTORY = 6;
const PERIODS_AHEAD = 3;

export async function getCashflowForecast(companyId: string, referenceDate: string): Promise<ForecastResult> {
  const monthEnds = lastNMonthEnds(MONTHS_OF_HISTORY, referenceDate);
  const accounts = await listChartOfAccounts(companyId);
  const bankAccounts = accounts.filter((a) => a.accountType === "Asset" && /bank|cash/i.test(a.description));
  const balances = await Promise.all(monthEnds.map((asOfDate) => getTrialBalance(companyId, asOfDate)));
  const series = monthEnds.map((period, i) => {
    const total = bankAccounts.reduce((sum, acc) => {
      const row = balances[i].rows.find((r) => r.accountId === acc.id);
      return sum + (row ? row.debitBalance - row.creditBalance : 0);
    }, 0);
    return { period, value: round2(total) };
  });
  return linearRegressionForecast(series, PERIODS_AHEAD, (idx) => monthLabelAfter(monthEnds, idx));
}

export async function getRevenueForecast(companyId: string, referenceDate: string): Promise<ForecastResult> {
  const monthEnds = lastNMonthEnds(MONTHS_OF_HISTORY, referenceDate);
  const series = await Promise.all(
    monthEnds.map(async (monthEnd) => {
      const monthStart = `${monthEnd.slice(0, 7)}-01`;
      const statement = await getIncomeStatement(companyId, monthStart, monthEnd);
      return { period: monthEnd, value: statement.revenue.total };
    }),
  );
  return linearRegressionForecast(series, PERIODS_AHEAD, (idx) => monthLabelAfter(monthEnds, idx));
}

export async function getExpenseForecast(companyId: string, referenceDate: string): Promise<ForecastResult> {
  const monthEnds = lastNMonthEnds(MONTHS_OF_HISTORY, referenceDate);
  const series = await Promise.all(
    monthEnds.map(async (monthEnd) => {
      const monthStart = `${monthEnd.slice(0, 7)}-01`;
      const statement = await getIncomeStatement(companyId, monthStart, monthEnd);
      return { period: monthEnd, value: statement.operatingExpenses.total };
    }),
  );
  return linearRegressionForecast(series, PERIODS_AHEAD, (idx) => monthLabelAfter(monthEnds, idx));
}

/** VAT Control (account 2300, seeded by `seed_company_defaults()` — see
 * Module 8) — credit-positive, so a growing balance reads as a growing
 * VAT payable position. */
export async function getVatForecast(companyId: string, referenceDate: string): Promise<ForecastResult> {
  const monthEnds = lastNMonthEnds(MONTHS_OF_HISTORY, referenceDate);
  const series = await monthlyAccountBalanceSeries(companyId, "2300", monthEnds, true);
  return linearRegressionForecast(series, PERIODS_AHEAD, (idx) => monthLabelAfter(monthEnds, idx));
}

/** Inventory Control (account 1500, seeded by `seed_company_defaults()`
 * — see the Inventory Platform module) — debit-positive stock value. */
export async function getInventoryForecast(companyId: string, referenceDate: string): Promise<ForecastResult> {
  const monthEnds = lastNMonthEnds(MONTHS_OF_HISTORY, referenceDate);
  const series = await monthlyAccountBalanceSeries(companyId, "1500", monthEnds, false);
  return linearRegressionForecast(series, PERIODS_AHEAD, (idx) => monthLabelAfter(monthEnds, idx));
}

export async function getCustomerPaymentForecast(companyId: string, referenceDate: string): Promise<ForecastResult> {
  const monthEnds = lastNMonthEnds(MONTHS_OF_HISTORY, referenceDate);
  const [invoices, receipts] = await Promise.all([listSalesInvoices(companyId), listCustomerReceipts(companyId)]);
  const allocations = receipts.flatMap((r) => r.allocations.map((a) => ({ invoiceId: a.invoiceId, allocatedAt: a.createdAt })));

  const series = monthEnds
    .map((monthEnd) => {
      const monthStart = `${monthEnd.slice(0, 7)}-01`;
      const monthInvoices = invoices.filter((inv) => inv.invoiceDate && inv.invoiceDate >= monthStart && inv.invoiceDate <= monthEnd);
      const days = computeCustomerAveragePaymentDays(monthInvoices, allocations);
      return days === null ? null : { period: monthEnd, value: days };
    })
    .filter((p): p is { period: string; value: number } => p !== null);

  return linearRegressionForecast(series, PERIODS_AHEAD, (idx) => monthLabelAfter(monthEnds, idx));
}

export async function getSupplierPaymentForecast(companyId: string, referenceDate: string): Promise<ForecastResult> {
  const monthEnds = lastNMonthEnds(MONTHS_OF_HISTORY, referenceDate);
  const [bills, payments] = await Promise.all([listPurchaseBills(companyId), listSupplierPayments(companyId)]);
  const allocations = payments.flatMap((p) => p.allocations.map((a) => ({ billId: a.billId, allocatedAt: a.createdAt })));

  const series = monthEnds
    .map((monthEnd) => {
      const monthStart = `${monthEnd.slice(0, 7)}-01`;
      const monthBills = bills.filter((b) => b.invoiceDate && b.invoiceDate >= monthStart && b.invoiceDate <= monthEnd);
      const days = computeSupplierAveragePaymentDays(monthBills, allocations);
      return days === null ? null : { period: monthEnd, value: days };
    })
    .filter((p): p is { period: string; value: number } => p !== null);

  return linearRegressionForecast(series, PERIODS_AHEAD, (idx) => monthLabelAfter(monthEnds, idx));
}
