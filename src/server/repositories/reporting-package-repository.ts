/**
 * Repository layer for generated Reporting Packages. See
 * supabase/migrations/0020_financial_statement_disclosure_engine.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { reportingPackageFromRow, type ReportingPackageRow } from "@/server/disclosures/mappers";
import type { ReportingPackage, ReportingPackageType } from "@/server/disclosures/types";

export async function listReportingPackages(companyId: string): Promise<ReportingPackage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("reporting_packages").select("*").eq("company_id", companyId).order("generated_at", { ascending: false }).returns<ReportingPackageRow[]>();
  if (error) throw error;
  return data.map(reportingPackageFromRow);
}

export type NewReportingPackage = { packageType: ReportingPackageType; periodStart: string; periodEnd: string; financialYearLabel: string; contents: Record<string, unknown>; generatedBy?: string };

export async function createReportingPackage(companyId: string, input: NewReportingPackage): Promise<ReportingPackage> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reporting_packages")
    .insert({
      company_id: companyId,
      package_type: input.packageType,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      financial_year_label: input.financialYearLabel,
      contents: input.contents,
      generated_by: input.generatedBy ?? "System",
    })
    .select("*")
    .single<ReportingPackageRow>();
  if (error) throw error;
  return reportingPackageFromRow(data);
}
