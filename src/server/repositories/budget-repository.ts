/**
 * Repository layer for Budgets — genuinely new, no prior entity. See
 * supabase/migrations/0016_financial_reporting_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { budgetFromRow, type BudgetRow } from "@/server/reporting/mappers";
import type { Budget } from "@/server/reporting/types";

export async function listBudgets(companyId: string, financialYearLabel?: string): Promise<Budget[]> {
  const supabase = await createClient();
  let query = supabase.from("budgets").select("*").eq("company_id", companyId);
  if (financialYearLabel) query = query.eq("financial_year_label", financialYearLabel);
  const { data, error } = await query.order("account_id").returns<BudgetRow[]>();
  if (error) throw error;
  return data.map(budgetFromRow);
}

export type NewBudget = {
  accountId: number;
  financialYearLabel: string;
  branchId?: number | null;
  departmentId?: number | null;
  costCentreId?: number | null;
  projectId?: number | null;
  amount: number;
  createdBy?: string;
};

export async function upsertBudget(companyId: string, input: NewBudget): Promise<Budget> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budgets")
    .upsert(
      {
        company_id: companyId,
        account_id: input.accountId,
        financial_year_label: input.financialYearLabel,
        branch_id: input.branchId ?? null,
        department_id: input.departmentId ?? null,
        cost_centre_id: input.costCentreId ?? null,
        project_id: input.projectId ?? null,
        amount: input.amount,
        created_by: input.createdBy ?? "System",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,account_id,financial_year_label,branch_id,department_id,cost_centre_id,project_id" },
    )
    .select("*")
    .single<BudgetRow>();
  if (error) throw error;
  return budgetFromRow(data);
}

export async function deleteBudget(companyId: string, budgetId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("budgets").delete().eq("company_id", companyId).eq("id", budgetId);
  if (error) throw error;
}
