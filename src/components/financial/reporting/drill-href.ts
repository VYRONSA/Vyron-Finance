/**
 * Where a drill-down leads. Every hop of the Reporting Centre's chain —
 * statement → document → journal → GL account → financial statement, and
 * bank transaction → its full trace — is a real page with the same
 * report shell, so the user can print or export at any depth.
 */

import type { DrillTarget, ReportCategory, ReportFilters } from "@/server/report-centre/types";

export type ReportHomeMap = Record<string, ReportCategory>;

export function reportHref(companyId: string, reportHome: ReportHomeMap, reportId: string, filters: ReportFilters = {}): string {
  const category = reportHome[reportId] ?? "financial";
  const query = new URLSearchParams({ report: reportId });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return `/company/${companyId}/reporting/${category}?${query.toString()}`;
}

export function drillHref(companyId: string, reportHome: ReportHomeMap, target: DrillTarget): string {
  switch (target.kind) {
    case "report":
      return reportHref(companyId, reportHome, target.reportId, target.filters);
    case "document":
      return `/company/${companyId}/reporting/documents/${target.docType}/${target.id}`;
    case "journal":
      return reportHref(companyId, reportHome, "journal-detail", { journalId: String(target.journalId) });
    case "bank-transaction":
      return reportHref(companyId, reportHome, "bank-transaction-detail", { transactionId: String(target.transactionId) });
  }
}
