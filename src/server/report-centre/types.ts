/**
 * VYRON Reporting Centre — the ONE report contract.
 *
 * Every report in the Reporting Centre, from a one-line Balance Summary
 * to a multi-section Management Pack, is a pure function from a
 * read-only `ReportDataset` to a `ReportResult`. The viewer, the print/
 * PDF document, the CSV and Excel exports, and the drill-down links are
 * all driven from this one shape — which is what keeps 100+ reports
 * looking and behaving like one product instead of 100 pages.
 *
 * Reporting is strictly READ ONLY. Nothing in `src/server/report-centre`
 * may write: see `read-only.test.ts`, which fails the build if a write
 * call ever appears here.
 */

export const REPORT_CATEGORIES = [
  "management",
  "financial",
  "customers",
  "suppliers",
  "sales",
  "purchasing",
  "banking",
  "vat",
  "general-ledger",
  "inventory",
  "audit",
  "documents",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ReportCategory, string> = {
  management: "Management",
  financial: "Financial",
  customers: "Customers",
  suppliers: "Suppliers",
  sales: "Sales",
  purchasing: "Purchasing",
  banking: "Banking",
  vat: "VAT & Tax",
  "general-ledger": "General Ledger",
  inventory: "Inventory",
  audit: "Audit & Compliance",
  documents: "Document Centre",
};

export function isReportCategory(value: string): value is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value);
}

/** Every filter a report can declare. One vocabulary for the whole
 * Reporting Centre, so "Customer" or "Date range" is the same control
 * with the same URL parameter on every report that supports it. */
export const REPORT_FILTER_KEYS = [
  "dateFrom",
  "dateTo",
  "asAt",
  "compareDateFrom",
  "compareDateTo",
  "customerId",
  "supplierId",
  "accountId",
  "accountType",
  "vatCode",
  "documentType",
  "status",
  "bankAccountId",
  "product",
  "category",
  "journalId",
  "transactionId",
  "reconciliationId",
  "importBatch",
] as const;
export type ReportFilterKey = (typeof REPORT_FILTER_KEYS)[number];

export const DATE_FILTER_KEYS: ReportFilterKey[] = ["dateFrom", "dateTo", "asAt", "compareDateFrom", "compareDateTo"];

export type ReportFilters = Partial<Record<ReportFilterKey, string>>;

export type FilterControl = "date" | "select" | "text";

/** Where a `select` filter's options come from — resolved from the same
 * dataset the report reads, never a hard-coded list of business data. */
export type FilterOptionSource =
  | "customers"
  | "suppliers"
  | "accounts"
  | "accountTypes"
  | "bankAccounts"
  | "vatCodes"
  | "stockItems"
  | "productCategories"
  | "journals"
  | "reconciliations"
  | "importBatches"
  | { static: { value: string; label: string }[] };

export type FilterSpec = {
  key: ReportFilterKey;
  label: string;
  control: FilterControl;
  options?: FilterOptionSource;
  /** A report that cannot be produced without this filter (e.g. a
   * Statement needs a customer) says so, and the viewer asks for it
   * rather than rendering an empty or misleading report. */
  required?: boolean;
};

export type ColumnKind = "text" | "date" | "money" | "number" | "percent" | "badge";

export type ReportColumn = {
  key: string;
  label: string;
  kind: ColumnKind;
};

export type ReportCell = string | number | null;

/** Where a row (or one cell of it) leads when clicked. Every hop of
 * "Financial Statement → Account → Transaction → Source document" is
 * one of these. */
export type DrillTarget =
  | { kind: "report"; reportId: string; filters: ReportFilters }
  | { kind: "document"; docType: DocumentType; id: number }
  | { kind: "journal"; journalId: number }
  | { kind: "bank-transaction"; transactionId: number };

export type DocumentType =
  | "quotation"
  | "sales-order"
  | "sales-invoice"
  | "customer-receipt"
  | "purchase-order"
  | "purchase-bill"
  | "supplier-payment";

export type RowKind = "detail" | "group" | "subtotal" | "total" | "note";

export type ReportRow = {
  kind: RowKind;
  cells: Record<string, ReportCell>;
  /** Indentation for hierarchical statements (group → account). */
  level?: number;
  drill?: DrillTarget;
  cellDrills?: Record<string, DrillTarget>;
};

export type ReportSection = {
  title?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  emptyMessage?: string;
};

export type SummaryItem = { label: string; value: number | string; kind: ColumnKind };

/** A statement that must hold for the report to be trusted — e.g.
 * "Trial Balance debits equal credits" or "Customer ledger equals the
 * Debtors control account". Shown on screen and on the printed report;
 * a failing check is never hidden. */
export type ReconciliationCheck = {
  label: string;
  expected: number;
  actual: number;
  difference: number;
  passed: boolean;
  explanation?: string;
};

export type ReportResult = {
  reportId: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  summary: SummaryItem[];
  sections: ReportSection[];
  checks: ReconciliationCheck[];
  /** Honest disclosures: what the report's figures are based on, what
   * data does not exist, what was capped. Never a fabricated figure. */
  notices: string[];
};

export const RECONCILIATION_TOLERANCE = 0.01;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function check(label: string, expected: number, actual: number, explanation?: string): ReconciliationCheck {
  const difference = round2(actual - expected);
  return { label, expected: round2(expected), actual: round2(actual), difference, passed: Math.abs(difference) <= RECONCILIATION_TOLERANCE, explanation };
}

/** Inclusive ISO-date range test; an absent bound is open-ended. */
export function inRange(date: string | null | undefined, from?: string, to?: string): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function sum<T>(items: T[], pick: (item: T) => number): number {
  return round2(items.reduce((total, item) => total + pick(item), 0));
}

/** A report could not be produced from the filters given (a required
 * filter is missing, a date is malformed, a referenced record doesn't
 * exist). Surfaced to the user as-is; anything else is a server error. */
export class ReportInputError extends Error {}
