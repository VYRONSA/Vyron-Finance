/**
 * Repository layer for the Chart of Accounts. Nesting (`parent_account_id`)
 * and the 8-value `account_type` enum are genuinely new — see
 * `supabase/migrations/0007_general_ledger.sql`'s header comment. Default
 * accounts are seeded via `seed_company_defaults()` at company-creation
 * time (same mechanism Tax Configuration already uses); this file is the
 * CRUD layer on top of whatever's on file.
 */

import { createClient } from "@/lib/supabase/server";
import { chartOfAccountFromRow, type ChartOfAccountRow } from "@/server/general-ledger/mappers";
import type { AccountType, ChartOfAccount, NormalBalance } from "@/server/general-ledger/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's own
// comment on this exact pattern. This query was unbounded until the
// Transaction Workspace's live GL lookup (UX-009) needed to guarantee it
// scales to "thousands of accounts" without silently relying on
// PostgREST's own default row cap; `company_id` already has a real index
// (0007_general_ledger.sql).
const LIST_CAP = 10_000;

export async function listChartOfAccounts(companyId: string): Promise<ChartOfAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("*")
    .eq("company_id", companyId)
    .order("account_code")
    .limit(LIST_CAP)
    .returns<ChartOfAccountRow[]>();
  if (error) throw error;
  return data.map(chartOfAccountFromRow);
}

export async function getChartOfAccount(companyId: string, accountId: number): Promise<ChartOfAccount | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", accountId)
    .maybeSingle<ChartOfAccountRow>();
  if (error) throw error;
  return data ? chartOfAccountFromRow(data) : null;
}

export type NewChartOfAccount = {
  accountCode: string;
  description: string;
  accountType: AccountType;
  category?: string;
  normalBalance: NormalBalance;
  parentAccountId?: number | null;
  reportingGroup?: string;
  financialStatementGroup?: string;
  taxTreatment?: string;
  branchId?: number | null;
  departmentId?: number | null;
  costCentreId?: number | null;
  projectId?: number | null;
  isControlAccount?: boolean;
  notes?: string;
};

export async function createChartOfAccount(companyId: string, input: NewChartOfAccount): Promise<ChartOfAccount> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .insert({
      company_id: companyId,
      account_code: input.accountCode,
      description: input.description,
      account_type: input.accountType,
      category: input.category ?? "",
      normal_balance: input.normalBalance,
      parent_account_id: input.parentAccountId ?? null,
      reporting_group: input.reportingGroup ?? "",
      financial_statement_group: input.financialStatementGroup ?? "",
      tax_treatment: input.taxTreatment ?? "",
      branch_id: input.branchId ?? null,
      department_id: input.departmentId ?? null,
      cost_centre_id: input.costCentreId ?? null,
      project_id: input.projectId ?? null,
      is_control_account: input.isControlAccount ?? false,
      notes: input.notes ?? "",
    })
    .select("*")
    .single<ChartOfAccountRow>();
  if (error) throw error;
  return chartOfAccountFromRow(data);
}

// account_code is deliberately excluded — immutable after creation,
// ported from the reference's `ChartOfAccountsService.update()`.
export type UpdatableChartOfAccountFields = Partial<{
  description: string;
  account_type: AccountType;
  category: string;
  normal_balance: NormalBalance;
  parent_account_id: number | null;
  reporting_group: string;
  financial_statement_group: string;
  tax_treatment: string;
  branch_id: number | null;
  department_id: number | null;
  cost_centre_id: number | null;
  project_id: number | null;
  is_control_account: boolean;
  is_active: boolean;
  notes: string;
}>;

export async function updateChartOfAccount(
  companyId: string,
  accountId: number,
  fields: UpdatableChartOfAccountFields,
): Promise<ChartOfAccount> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .update(fields)
    .eq("company_id", companyId)
    .eq("id", accountId)
    .select("*")
    .single<ChartOfAccountRow>();
  if (error) throw error;
  return chartOfAccountFromRow(data);
}

export async function setChartOfAccountActive(companyId: string, accountId: number, isActive: boolean): Promise<ChartOfAccount> {
  return updateChartOfAccount(companyId, accountId, { is_active: isActive });
}
