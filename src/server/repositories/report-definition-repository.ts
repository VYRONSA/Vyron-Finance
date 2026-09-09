/**
 * Repository layer for saved Report Designer layouts. See
 * supabase/migrations/0016_financial_reporting_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { reportDefinitionFromRow, type ReportDefinitionRow } from "@/server/reporting/mappers";
import type { CalculatedField, ReportColumn, ReportDefinition, ReportFilters, ReportGroup, ReportType } from "@/server/reporting/types";

export async function listReportDefinitions(companyId: string): Promise<ReportDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_definitions")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .returns<ReportDefinitionRow[]>();
  if (error) throw error;
  return data.map(reportDefinitionFromRow);
}

export async function getReportDefinition(companyId: string, id: number): Promise<ReportDefinition | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_definitions")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle<ReportDefinitionRow>();
  if (error) throw error;
  return data ? reportDefinitionFromRow(data) : null;
}

export type NewReportDefinition = {
  name: string;
  reportType: ReportType;
  columns: ReportColumn[];
  groups: ReportGroup[];
  filters: ReportFilters;
  calculatedFields: CalculatedField[];
  createdBy?: string;
};

export async function createReportDefinition(companyId: string, input: NewReportDefinition): Promise<ReportDefinition> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_definitions")
    .insert({
      company_id: companyId,
      name: input.name,
      report_type: input.reportType,
      columns: input.columns,
      groups: input.groups,
      filters: input.filters,
      calculated_fields: input.calculatedFields,
      created_by: input.createdBy ?? "System",
    })
    .select("*")
    .single<ReportDefinitionRow>();
  if (error) throw error;
  return reportDefinitionFromRow(data);
}

export async function deleteReportDefinition(companyId: string, id: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("report_definitions").delete().eq("company_id", companyId).eq("id", id);
  if (error) throw error;
}
