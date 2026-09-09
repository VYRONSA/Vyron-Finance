/**
 * Row <-> domain type mappers for the Financial Reporting & Executive
 * Intelligence Platform (Module 9). See
 * supabase/migrations/0016_financial_reporting_platform.sql.
 */

import type { Budget, ExecutiveAlert, ReportDefinition } from "./types";

export type BudgetRow = {
  id: number;
  company_id: string;
  account_id: number;
  financial_year_label: string;
  branch_id: number | null;
  department_id: number | null;
  cost_centre_id: number | null;
  project_id: number | null;
  amount: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function budgetFromRow(row: BudgetRow): Budget {
  return {
    id: row.id,
    companyId: row.company_id,
    accountId: row.account_id,
    financialYearLabel: row.financial_year_label,
    branchId: row.branch_id,
    departmentId: row.department_id,
    costCentreId: row.cost_centre_id,
    projectId: row.project_id,
    amount: Number(row.amount),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ReportDefinitionRow = {
  id: number;
  company_id: string;
  name: string;
  report_type: string;
  columns: unknown;
  groups: unknown;
  filters: unknown;
  calculated_fields: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function reportDefinitionFromRow(row: ReportDefinitionRow): ReportDefinition {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    reportType: row.report_type as ReportDefinition["reportType"],
    columns: (row.columns as ReportDefinition["columns"]) ?? [],
    groups: (row.groups as ReportDefinition["groups"]) ?? [],
    filters: (row.filters as ReportDefinition["filters"]) ?? {},
    calculatedFields: (row.calculated_fields as ReportDefinition["calculatedFields"]) ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ExecutiveAlertRow = {
  id: number;
  company_id: string;
  alert_type: string;
  priority: string;
  reason: string;
  evidence: string;
  recommended_action: string;
  related_type: string | null;
  related_id: number | null;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

export function executiveAlertFromRow(row: ExecutiveAlertRow): ExecutiveAlert {
  return {
    id: row.id,
    companyId: row.company_id,
    alertType: row.alert_type as ExecutiveAlert["alertType"],
    priority: row.priority as ExecutiveAlert["priority"],
    reason: row.reason,
    evidence: row.evidence,
    recommendedAction: row.recommended_action,
    relatedType: row.related_type,
    relatedId: row.related_id,
    status: row.status as ExecutiveAlert["status"],
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
  };
}
