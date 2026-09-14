/**
 * The shared toolkit every report builder uses — one definition shape,
 * one way to express columns/rows/drill-downs, one control-account
 * reconciliation check. Keeping these in one place is what makes every
 * report behave identically in the viewer, on paper, and in exports.
 */

import type { ReportCompany, ReportDataSource } from "./source";
import {
  check,
  round2,
  type ColumnKind,
  type DocumentType,
  type DrillTarget,
  type FilterSpec,
  type ReconciliationCheck,
  type ReportCategory,
  type ReportCell,
  type ReportColumn,
  type ReportFilters,
  type ReportResult,
  type ReportRow,
  type ReportSection,
  type SummaryItem,
} from "./types";

/** Filters after defaults are applied — every date a report declares is
 * guaranteed present. */
export type ResolvedFilters = ReportFilters & { dateFrom: string; dateTo: string; asAt: string };

export type ReportContext = {
  source: ReportDataSource;
  filters: ResolvedFilters;
  company: ReportCompany;
  today: string;
};

export type ReportBody = Pick<ReportResult, "subtitle" | "summary" | "sections" | "checks" | "notices">;

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  categories: ReportCategory[];
  filters: FilterSpec[];
  /** Customer statements can be emailed to the customer. */
  emailable?: boolean;
  build: (ctx: ReportContext) => Promise<ReportBody>;
};

// ---------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------

export const F = {
  period: [
    { key: "dateFrom", label: "From", control: "date" },
    { key: "dateTo", label: "To", control: "date" },
  ] as FilterSpec[],
  asAt: { key: "asAt", label: "As at", control: "date" } as FilterSpec,
  customer: (required = false): FilterSpec => ({ key: "customerId", label: "Customer", control: "select", options: "customers", required }),
  supplier: (required = false): FilterSpec => ({ key: "supplierId", label: "Supplier", control: "select", options: "suppliers", required }),
  account: (required = false): FilterSpec => ({ key: "accountId", label: "GL Account", control: "select", options: "accounts", required }),
  accountType: { key: "accountType", label: "Account Group", control: "select", options: "accountTypes" } as FilterSpec,
  vatCode: { key: "vatCode", label: "VAT Code", control: "select", options: "vatCodes" } as FilterSpec,
  bankAccount: { key: "bankAccountId", label: "Bank Account", control: "select", options: "bankAccounts" } as FilterSpec,
  product: { key: "product", label: "Product", control: "select", options: "stockItems" } as FilterSpec,
  category: { key: "category", label: "Category", control: "select", options: "productCategories" } as FilterSpec,
  journal: (required = false): FilterSpec => ({ key: "journalId", label: "Journal", control: "select", options: "journals", required }),
  status: (values: string[]): FilterSpec => ({ key: "status", label: "Status", control: "select", options: { static: values.map((v) => ({ value: v, label: v })) } }),
  documentType: (values: string[]): FilterSpec => ({ key: "documentType", label: "Document Type", control: "select", options: { static: values.map((v) => ({ value: v, label: v })) } }),
  compare: [
    { key: "compareDateFrom", label: "Compare From", control: "date" },
    { key: "compareDateTo", label: "Compare To", control: "date" },
  ] as FilterSpec[],
};

export function numberFilter(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------
// Columns, rows, drill-downs
// ---------------------------------------------------------------------

export const col = (key: string, label: string, kind: ColumnKind = "text"): ReportColumn => ({ key, label, kind });

export function row(cells: Record<string, ReportCell>, extra: Partial<Omit<ReportRow, "cells">> = {}): ReportRow {
  return { kind: "detail", cells, ...extra };
}
export const groupRow = (cells: Record<string, ReportCell>, extra: Partial<Omit<ReportRow, "cells" | "kind">> = {}): ReportRow => ({ kind: "group", cells, ...extra });
export const subtotalRow = (cells: Record<string, ReportCell>, extra: Partial<Omit<ReportRow, "cells" | "kind">> = {}): ReportRow => ({ kind: "subtotal", cells, ...extra });
export const totalRow = (cells: Record<string, ReportCell>): ReportRow => ({ kind: "total", cells });
export const noteRow = (text: string, key = "note"): ReportRow => ({ kind: "note", cells: { [key]: text } });

export const drill = {
  report: (reportId: string, filters: ReportFilters): DrillTarget => ({ kind: "report", reportId, filters }),
  document: (docType: DocumentType, id: number): DrillTarget => ({ kind: "document", docType, id }),
  journal: (journalId: number): DrillTarget => ({ kind: "journal", journalId }),
  bank: (transactionId: number): DrillTarget => ({ kind: "bank-transaction", transactionId }),
};

export function section(columns: ReportColumn[], rows: ReportRow[], title?: string, emptyMessage?: string): ReportSection {
  return { title, columns, rows, emptyMessage };
}

export const summaryMoney = (label: string, value: number): SummaryItem => ({ label, value: round2(value), kind: "money" });
export const summaryCount = (label: string, value: number): SummaryItem => ({ label, value, kind: "number" });
export const summaryText = (label: string, value: string): SummaryItem => ({ label, value, kind: "text" });

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------

export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function shiftYears(isoDate: string, years: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y + years, m - 1, 1));
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export const periodLabel = (from: string, to: string) => `${formatDate(from)} to ${formatDate(to)}`;
export const asAtLabel = (asAt: string) => `As at ${formatDate(asAt)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}
/** Every month key from `from` to `to` inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ey, em] = to.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
export function monthEnd(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// Control-account reconciliation
// ---------------------------------------------------------------------

/** Balance of a GL account as at a date from the Trial Balance, signed
 * so a normal balance is positive: debit-normal for Debtors,
 * credit-normal for Creditors. `null` when the account doesn't exist. */
export async function glAccountBalance(source: ReportDataSource, accountCode: string, asAt: string, creditNormal: boolean): Promise<number | null> {
  const tb = await source.trialBalance(asAt);
  const rowForAccount = tb.find((r) => r.accountCode === accountCode);
  if (!rowForAccount) return null;
  const net = round2(rowForAccount.totalDebit - rowForAccount.totalCredit);
  return creditNormal ? round2(-net) : net;
}

/** "Subsidiary ledger = control account" — the reconciliation every
 * customer and supplier balance report carries. */
export async function controlAccountCheck(
  ctx: ReportContext,
  side: "customer" | "supplier",
  ledgerTotal: number,
  asAt: string,
): Promise<{ checks: ReconciliationCheck[]; notices: string[] }> {
  const controls = await ctx.source.controlAccounts();
  const code = side === "customer" ? controls.debtors : controls.creditors;
  const label = side === "customer" ? "Debtors" : "Creditors";
  if (!code) {
    return { checks: [], notices: [`No ${label} control account is configured in this company's posting rules, so this report cannot be reconciled to the General Ledger.`] };
  }
  const gl = await glAccountBalance(ctx.source, code, asAt, side === "supplier");
  if (gl === null) {
    return { checks: [], notices: [`The ${label} control account (${code}) named by the posting rules is not in the Chart of Accounts.`] };
  }
  return {
    checks: [
      check(
        `${side === "customer" ? "Customer" : "Supplier"} ledger total equals ${label} control account ${code} (${formatDate(asAt)})`,
        gl,
        ledgerTotal,
        `A difference means something moved the ${label} control account without a ${side} attached (e.g. a manual journal to account ${code}), or a ${side} document was posted to a different account.`,
      ),
    ],
    notices: [],
  };
}
