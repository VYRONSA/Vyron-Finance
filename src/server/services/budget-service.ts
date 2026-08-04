/**
 * Application Service for Budgets — thin validation layer over
 * `budget-repository.ts`, feeding the Budget vs Actual management report.
 */

import * as repo from "@/server/repositories/budget-repository";
import type { Budget } from "@/server/reporting/types";

export class ValidationError extends Error {}

export const listBudgets = repo.listBudgets;

export async function upsertBudget(companyId: string, performedBy: string, input: repo.NewBudget): Promise<Budget> {
  if (!input.financialYearLabel?.trim()) throw new ValidationError("Financial year is required.");
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new ValidationError("Amount must be a non-negative number.");
  return repo.upsertBudget(companyId, { ...input, createdBy: performedBy });
}

export const deleteBudget = repo.deleteBudget;
