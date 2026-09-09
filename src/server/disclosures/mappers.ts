/**
 * Row <-> domain type mappers for the GAAP-Compliant Financial Statements
 * & Disclosure Engine (Module 13). See
 * supabase/migrations/0020_financial_statement_disclosure_engine.sql.
 */

import type { DisclosureNote, ReportingPackage } from "./types";

export type DisclosureNoteRow = {
  id: number;
  company_id: string;
  period_start: string;
  period_end: string;
  note_type: string;
  title: string;
  generated_content: unknown;
  requires_user_input: boolean;
  user_notes: string;
  generated_at: string;
  generated_by: string;
  updated_at: string;
};

export function disclosureNoteFromRow(row: DisclosureNoteRow): DisclosureNote {
  return {
    id: row.id,
    companyId: row.company_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    noteType: row.note_type as DisclosureNote["noteType"],
    title: row.title,
    generatedContent: (row.generated_content as Record<string, unknown>) ?? {},
    requiresUserInput: row.requires_user_input,
    userNotes: row.user_notes,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    updatedAt: row.updated_at,
  };
}

export type ReportingPackageRow = {
  id: number;
  company_id: string;
  package_type: string;
  period_start: string;
  period_end: string;
  financial_year_label: string;
  contents: unknown;
  generated_at: string;
  generated_by: string;
};

export function reportingPackageFromRow(row: ReportingPackageRow): ReportingPackage {
  return {
    id: row.id,
    companyId: row.company_id,
    packageType: row.package_type as ReportingPackage["packageType"],
    periodStart: row.period_start,
    periodEnd: row.period_end,
    financialYearLabel: row.financial_year_label,
    contents: (row.contents as Record<string, unknown>) ?? {},
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  };
}
