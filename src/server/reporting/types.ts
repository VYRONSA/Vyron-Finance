/**
 * Domain types for the Financial Reporting & Executive Intelligence
 * Platform (Module 9). See supabase/migrations/0016_financial_reporting_platform.sql.
 *
 * Financial Statements themselves (Income Statement/Balance Sheet/Cash
 * Flow) are computed, not stored — their types live alongside the pure
 * engines that produce them (`income-statement-engine.ts` etc.), not
 * here. This file holds the genuinely new persisted entities: Budgets,
 * Report Definitions, and Executive Alerts.
 */

export type Budget = {
  id: number;
  companyId: string;
  accountId: number;
  financialYearLabel: string;
  branchId: number | null;
  departmentId: number | null;
  costCentreId: number | null;
  projectId: number | null;
  amount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ReportType = "TrialBalance" | "IncomeStatement" | "BalanceSheet" | "CashFlow" | "GLInquiry" | "BudgetVsActual" | "Custom";

export const REPORT_TYPES: ReportType[] = ["TrialBalance", "IncomeStatement", "BalanceSheet", "CashFlow", "GLInquiry", "BudgetVsActual", "Custom"];

export type ReportColumn = { field: string; label: string };
export type ReportGroup = { field: string; label: string };
export type ReportFilters = {
  branchId?: number | null;
  departmentId?: number | null;
  costCentreId?: number | null;
  projectId?: number | null;
};
/** A minimal, safe (no `eval`) calculated field: `left <op> right`, each
 * operand either a literal number or another column's field name. See
 * `report-definition-service.ts::evaluateCalculatedField`. */
export type CalculatedField = {
  name: string;
  left: string;
  operator: "+" | "-" | "*" | "/";
  right: string;
};

export type ReportDefinition = {
  id: number;
  companyId: string;
  name: string;
  reportType: ReportType;
  columns: ReportColumn[];
  groups: ReportGroup[];
  filters: ReportFilters;
  calculatedFields: CalculatedField[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ExecutiveAlertType =
  | "DecliningCash"
  | "IncreasingDebtors"
  | "SlowPayingCustomers"
  | "SupplierRisk"
  | "MarginReduction"
  | "InventoryProblems"
  | "ComplianceIssues"
  | "AutomationFailures"
  | "LargeUnusualTransactions"
  | "DuplicateTrends";

export const EXECUTIVE_ALERT_TYPES: ExecutiveAlertType[] = [
  "DecliningCash",
  "IncreasingDebtors",
  "SlowPayingCustomers",
  "SupplierRisk",
  "MarginReduction",
  "InventoryProblems",
  "ComplianceIssues",
  "AutomationFailures",
  "LargeUnusualTransactions",
  "DuplicateTrends",
];

export type ExecutiveAlertPriority = "Low" | "Medium" | "High" | "Critical";
export type ExecutiveAlertStatus = "Open" | "Resolved" | "Dismissed";

export type ExecutiveAlert = {
  id: number;
  companyId: string;
  alertType: ExecutiveAlertType;
  priority: ExecutiveAlertPriority;
  reason: string;
  evidence: string;
  recommendedAction: string;
  relatedType: string | null;
  relatedId: number | null;
  status: ExecutiveAlertStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
};
