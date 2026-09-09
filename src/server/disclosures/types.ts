/**
 * Domain types for the GAAP-Compliant Financial Statements & Disclosure
 * Engine (Module 13). See
 * supabase/migrations/0020_financial_statement_disclosure_engine.sql.
 */

export type DisclosureNoteType =
  | "AccountingPolicies"
  | "SignificantJudgements"
  | "Estimates"
  | "FixedAssetNotes"
  | "InventoryNotes"
  | "VatNotes"
  | "RevenueNotes"
  | "ExpenseNotes"
  | "RelatedPartyTransactions"
  | "CommitmentsAndContingencies"
  | "EventsAfterReportingDate";

export const DISCLOSURE_NOTE_TYPES: DisclosureNoteType[] = [
  "AccountingPolicies",
  "SignificantJudgements",
  "Estimates",
  "FixedAssetNotes",
  "InventoryNotes",
  "VatNotes",
  "RevenueNotes",
  "ExpenseNotes",
  "RelatedPartyTransactions",
  "CommitmentsAndContingencies",
  "EventsAfterReportingDate",
];

/** Note types with a real, computable data source in this platform today.
 * The rest (`RelatedPartyTransactions`/`CommitmentsAndContingencies`/
 * `EventsAfterReportingDate` — no such data source exists anywhere in the
 * codebase; `AccountingPolicies`/`SignificantJudgements`/`Estimates` —
 * genuinely a judgement call for the preparer, not derivable from
 * transactional data) are generated as honest placeholders that
 * `requiresUserInput`. */
export const DATA_DRIVEN_NOTE_TYPES: DisclosureNoteType[] = ["FixedAssetNotes", "InventoryNotes", "VatNotes", "RevenueNotes", "ExpenseNotes"];

export type DisclosureNote = {
  id: number;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  noteType: DisclosureNoteType;
  title: string;
  generatedContent: Record<string, unknown>;
  requiresUserInput: boolean;
  userNotes: string;
  generatedAt: string;
  generatedBy: string;
  updatedAt: string;
};

export type ReportingPackageType = "ManagementPack" | "BoardPack" | "AccountantPack" | "AuditorPack";
export const REPORTING_PACKAGE_TYPES: ReportingPackageType[] = ["ManagementPack", "BoardPack", "AccountantPack", "AuditorPack"];

export type ReportingPackage = {
  id: number;
  companyId: string;
  packageType: ReportingPackageType;
  periodStart: string;
  periodEnd: string;
  financialYearLabel: string;
  contents: Record<string, unknown>;
  generatedAt: string;
  generatedBy: string;
};
