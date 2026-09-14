/**
 * Every report in the Reporting Centre, in the order each category page
 * lists them. A report can appear in more than one category (a Customer
 * Statement is both a Customers report and a Document Centre document)
 * but is defined exactly once.
 */

import type { ReportDefinition } from "./kit";
import type { FilterSpec, ReportCategory } from "./types";
import { MANAGEMENT_REPORTS } from "./builders/management";
import { FINANCIAL_REPORTS } from "./builders/financial";
import { GENERAL_LEDGER_REPORTS } from "./builders/general-ledger";
import { CUSTOMER_REPORTS, SUPPLIER_REPORTS } from "./builders/party";
import { PURCHASING_REPORTS, SALES_REPORTS } from "./builders/trade";
import { BANKING_REPORTS } from "./builders/banking";
import { VAT_REPORTS } from "./builders/vat";
import { INVENTORY_REPORTS } from "./builders/inventory";
import { DOCUMENT_REPORTS } from "./builders/documents";

export const REPORTS: ReportDefinition[] = [
  ...MANAGEMENT_REPORTS,
  ...FINANCIAL_REPORTS,
  ...GENERAL_LEDGER_REPORTS,
  ...CUSTOMER_REPORTS,
  ...SUPPLIER_REPORTS,
  ...SALES_REPORTS,
  ...PURCHASING_REPORTS,
  ...BANKING_REPORTS,
  ...VAT_REPORTS,
  ...INVENTORY_REPORTS,
  ...DOCUMENT_REPORTS,
];

export const REPORT_BY_ID = new Map(REPORTS.map((r) => [r.id, r]));

/** The serialisable description of a report the browser needs — no
 * `build` function. */
export type ReportCatalogEntry = {
  id: string;
  title: string;
  description: string;
  categories: ReportCategory[];
  filters: FilterSpec[];
  emailable: boolean;
};

export function catalogEntry(def: ReportDefinition): ReportCatalogEntry {
  return { id: def.id, title: def.title, description: def.description, categories: def.categories, filters: def.filters, emailable: Boolean(def.emailable) };
}

export function reportCatalog(): ReportCatalogEntry[] {
  return REPORTS.map(catalogEntry);
}

export function reportsInCategory(category: ReportCategory): ReportCatalogEntry[] {
  return REPORTS.filter((r) => r.categories.includes(category)).map(catalogEntry);
}

/** The category a report is "home" in — its first listed category. */
export function homeCategory(reportId: string): ReportCategory | null {
  return REPORT_BY_ID.get(reportId)?.categories[0] ?? null;
}

/** reportId → the category page it lives on, for building drill-down
 * links in the browser without shipping the report builders there. */
export function reportHomeMap(): Record<string, ReportCategory> {
  return Object.fromEntries(REPORTS.map((r) => [r.id, r.categories[0]]));
}
