/**
 * Financial Year period math — ported field-for-field from the
 * reference's `accounting/period_manager.py` (`FINANCIAL_YEAR_START_MONTH
 * = 3`, the South African tax year), generalized to take the start month
 * as a parameter since it's now a per-company setting
 * (`companies.financial_year_start_month`) rather than a hardcoded
 * constant. A financial year is identified by the calendar year it ENDS
 * in; a financial period is the 1-based month number counting from the
 * start month, so period 1 is always the first month of the financial
 * year.
 */

import * as repo from "@/server/repositories/financial-year-repository";
import type { FinancialYear } from "@/server/company-management/types";

export class ValidationError extends Error {}

function parseIsoDate(dateStr: string): { year: number; month: number } {
  const [year, month] = dateStr.split("-").map(Number);
  return { year, month };
}

/** `"FY2026"` — the reference's own `get_financial_year`. */
export function computeFinancialYearLabel(dateStr: string, startMonth: number): string {
  const { year, month } = parseIsoDate(dateStr);
  const endYear = month >= startMonth ? year + 1 : year;
  return `FY${endYear}`;
}

/** 1-based period within the financial year — the reference's own
 * `get_financial_period`. Python's `%` is floor-mod (always
 * non-negative for a positive divisor); JS's `%` is remainder-mod (can
 * be negative), so the `+12) % 12` normalization below is required to
 * match it exactly, not stylistic. */
export function computeFinancialPeriod(dateStr: string, startMonth: number): number {
  const { month } = parseIsoDate(dateStr);
  return (((month - startMonth) % 12) + 12) % 12 + 1;
}

/** `"P01"`..`"P12"` — the reference's own `get_period_label`. */
export function computePeriodLabel(dateStr: string, startMonth: number): string {
  return `P${String(computeFinancialPeriod(dateStr, startMonth)).padStart(2, "0")}`;
}

function lastDayOfMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Start/end dates for the financial year ending in `endCalendarYear`
 * (e.g. `endCalendarYear=2026, startMonth=3` -> 2025-03-01..2026-02-28/29). */
export function computeFinancialYearBounds(endCalendarYear: number, startMonth: number): { startDate: string; endDate: string } {
  const startYear = startMonth === 1 ? endCalendarYear : endCalendarYear - 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = endCalendarYear;
  const endDay = lastDayOfMonth(endYear, endMonth);
  return {
    startDate: `${startYear}-${pad2(startMonth)}-01`,
    endDate: `${endYear}-${pad2(endMonth)}-${pad2(endDay)}`,
  };
}

/** The financial year (label + real start/end dates) that `referenceDate`
 * falls within, for a company with the given start month — used to
 * pre-fill the "create financial year" form. */
export function suggestFinancialYear(referenceDate: string, startMonth: number): { yearLabel: string; startDate: string; endDate: string } {
  const yearLabel = computeFinancialYearLabel(referenceDate, startMonth);
  const endCalendarYear = Number(yearLabel.slice(2));
  return { yearLabel, ...computeFinancialYearBounds(endCalendarYear, startMonth) };
}

export function listFinancialYears(companyId: string): Promise<FinancialYear[]> {
  return repo.listFinancialYears(companyId);
}

export type NewFinancialYearRequest = {
  yearLabel: string;
  startDate: string;
  endDate: string;
};

export async function createFinancialYear(companyId: string, input: NewFinancialYearRequest): Promise<FinancialYear> {
  if (!input.yearLabel?.trim()) throw new ValidationError("Year label is required.");
  if (!input.startDate || !input.endDate) throw new ValidationError("Start and end dates are required.");
  if (input.startDate >= input.endDate) throw new ValidationError("Start date must be before end date.");
  return repo.createFinancialYear(companyId, {
    yearLabel: input.yearLabel.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
  });
}

export function setCurrentFinancialYear(companyId: string, financialYearId: number): Promise<FinancialYear> {
  return repo.setCurrentFinancialYear(companyId, financialYearId);
}

export function closeFinancialYear(companyId: string, financialYearId: number): Promise<FinancialYear> {
  return repo.closeFinancialYear(companyId, financialYearId);
}
