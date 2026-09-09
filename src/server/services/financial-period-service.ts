/**
 * Financial Period locking — genuinely new capability, neither reference
 * backend ever had it (see `supabase/migrations/0007_general_ledger.sql`'s
 * header comment). Builds on `financial-year-service.ts`'s real period
 * math (`computeFinancialYearLabel`/`computeFinancialPeriod`), adding the
 * one check the Posting Engine calls before writing anything to
 * `gl_transactions`: is this posting date even allowed?
 */

import * as repo from "@/server/repositories/financial-year-repository";
import { getPerformedByLabel } from "@/server/auth/require-session";
import type { FinancialYear } from "@/server/company-management/types";

export class ValidationError extends Error {}

export type PostingDateValidation = { ok: true; financialYear: FinancialYear } | { ok: false; reason: string };

/** Pure — unit tested exhaustively since a bug here would let the Posting
 * Engine write into a period it shouldn't. Rejects a posting date when: no
 * financial year covers it at all, the covering year is Closed, or the
 * date falls on/before the year's `lockDate` — a soft pre-close lock that
 * blocks postings even while the year is still technically Open. */
export function checkPostingDate(financialYears: FinancialYear[], postingDate: string): PostingDateValidation {
  const financialYear = financialYears.find((fy) => fy.startDate <= postingDate && postingDate <= fy.endDate);
  if (!financialYear) return { ok: false, reason: `No financial year covers ${postingDate}.` };
  if (financialYear.status === "Closed") return { ok: false, reason: `Financial year ${financialYear.yearLabel} is closed.` };
  if (financialYear.lockDate && postingDate <= financialYear.lockDate) {
    return { ok: false, reason: `${postingDate} is on or before the ${financialYear.yearLabel} lock date (${financialYear.lockDate}).` };
  }
  return { ok: true, financialYear };
}

export async function validatePostingDate(companyId: string, postingDate: string): Promise<PostingDateValidation> {
  const financialYears = await repo.listFinancialYears(companyId);
  return checkPostingDate(financialYears, postingDate);
}

export async function setLockDate(companyId: string, financialYearId: number, lockDate: string | null): Promise<FinancialYear> {
  if (lockDate !== null && Number.isNaN(Date.parse(lockDate))) throw new ValidationError("Lock date is not a valid date.");
  return repo.setFinancialYearLockDate(companyId, financialYearId, lockDate);
}

export async function reopenFinancialYear(companyId: string, financialYearId: number): Promise<FinancialYear> {
  const performedBy = await getPerformedByLabel();
  return repo.reopenFinancialYear(companyId, financialYearId, performedBy);
}
