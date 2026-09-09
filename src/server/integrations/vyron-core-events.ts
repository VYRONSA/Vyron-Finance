/**
 * VYRON CORE — Workforce Intelligence Platform. Owns HR, Employee
 * Management, Time & Attendance, Clocking, Rostering, Leave,
 * Compliance, Workforce Intelligence, Payroll Readiness, HR Operations
 * — it prepares workforce data for payroll and finance, it is not the
 * payroll ledger. Per the Product Review Board's Phase 4 directive,
 * VYRON CORE owns HR and workforce operations; VYRON FINANCE owns
 * accounting. These are the named event types in that directive's own
 * event chain that carry financial consequence — VYRON FINANCE
 * performs the accounting for each once a real connection exists.
 * ("Labour Analytics", the chain's own final link, is an analytics
 * read-model with no GL impact and is deliberately not modelled as a
 * postable event here.)
 *
 * See `event-contract.ts` for why this is a type-only architecture file
 * (no transport, no sync, no mock/seeded data).
 */

import type { IntegrationBusinessEvent } from "./event-contract";

export type VyronCoreEventType =
  | "vyron_core.approved_timesheet.v1"
  | "vyron_core.payroll_ready_hours.v1"
  | "vyron_core.labour_cost_allocation.v1"
  | "vyron_core.department_costing.v1"
  | "vyron_core.branch_costing.v1"
  | "vyron_core.project_costing.v1"
  | "vyron_core.employee_expense_claim.v1"
  | "vyron_core.travel_claim.v1"
  | "vyron_core.leave_provision.v1"
  | "vyron_core.payroll_journal_import.v1";

export type ApprovedTimesheetPayload = {
  employeeReference: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  hoursWorked: number;
  overtimeHours: number;
  approvedBy: string;
  approvedAt: string;
};

export type PayrollReadyHoursPayload = {
  employeeReference: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  regularHours: number;
  overtimeHours: number;
  leaveHours: number;
};

export type LabourCostAllocationPayload = {
  employeeReference: string;
  branchReference: string | null;
  departmentReference: string | null;
  projectReference: string | null;
  hours: number;
  hourlyRate: number;
  allocatedCost: number;
  payPeriodStart: string;
  payPeriodEnd: string;
};

export type DepartmentCostingPayload = {
  departmentReference: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  totalLabourCost: number;
};

export type BranchCostingPayload = {
  branchReference: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  totalLabourCost: number;
};

export type ProjectCostingPayload = {
  projectReference: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  totalLabourCost: number;
};

export type EmployeeExpenseClaimPayload = {
  employeeReference: string;
  claimReference: string;
  category: string;
  amount: number;
  submittedAt: string;
  approvedAt: string | null;
};

export type TravelClaimPayload = {
  employeeReference: string;
  claimReference: string;
  tripReference: string;
  amount: number;
  submittedAt: string;
  approvedAt: string | null;
};

export type LeaveProvisionPayload = {
  employeeReference: string;
  leaveType: string;
  daysAccrued: number;
  monetaryValue: number;
  asOfDate: string;
};

export type PayrollJournalImportPayload = {
  payrollReference: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  grossPay: number;
  employeeDeductions: number;
  employerContributions: number;
  netPay: number;
};

export type VyronCoreEvent =
  | IntegrationBusinessEvent<"vyron_core.approved_timesheet.v1", ApprovedTimesheetPayload>
  | IntegrationBusinessEvent<"vyron_core.payroll_ready_hours.v1", PayrollReadyHoursPayload>
  | IntegrationBusinessEvent<"vyron_core.labour_cost_allocation.v1", LabourCostAllocationPayload>
  | IntegrationBusinessEvent<"vyron_core.department_costing.v1", DepartmentCostingPayload>
  | IntegrationBusinessEvent<"vyron_core.branch_costing.v1", BranchCostingPayload>
  | IntegrationBusinessEvent<"vyron_core.project_costing.v1", ProjectCostingPayload>
  | IntegrationBusinessEvent<"vyron_core.employee_expense_claim.v1", EmployeeExpenseClaimPayload>
  | IntegrationBusinessEvent<"vyron_core.travel_claim.v1", TravelClaimPayload>
  | IntegrationBusinessEvent<"vyron_core.leave_provision.v1", LeaveProvisionPayload>
  | IntegrationBusinessEvent<"vyron_core.payroll_journal_import.v1", PayrollJournalImportPayload>;

/** The one lookup a future VYRON CORE event handler needs: which
 * `posting_rules.event_type` (migration 0007) a company's own rule is
 * configured under for this event. Pure and exhaustive — a new
 * `VyronCoreEventType` member fails `tsc`, not silently falls through,
 * matching this codebase's established pattern for event-type dispatch
 * (see `posting-rule-service.ts`). */
export function postingEventTypeForVyronCoreEvent(eventType: VyronCoreEventType): string {
  switch (eventType) {
    case "vyron_core.approved_timesheet.v1":
      return "VYRON CORE Approved Timesheet";
    case "vyron_core.payroll_ready_hours.v1":
      return "VYRON CORE Payroll Ready Hours";
    case "vyron_core.labour_cost_allocation.v1":
      return "VYRON CORE Labour Cost Allocation";
    case "vyron_core.department_costing.v1":
      return "VYRON CORE Department Costing";
    case "vyron_core.branch_costing.v1":
      return "VYRON CORE Branch Costing";
    case "vyron_core.project_costing.v1":
      return "VYRON CORE Project Costing";
    case "vyron_core.employee_expense_claim.v1":
      return "VYRON CORE Employee Expense Claim";
    case "vyron_core.travel_claim.v1":
      return "VYRON CORE Travel Claim";
    case "vyron_core.leave_provision.v1":
      return "VYRON CORE Leave Provision";
    case "vyron_core.payroll_journal_import.v1":
      return "VYRON CORE Payroll Journal Import";
  }
}
