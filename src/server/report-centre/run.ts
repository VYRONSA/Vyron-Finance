/**
 * The Reporting Centre runner — the one entry point the API routes, the
 * pages and the print/PDF view call. It applies the same defaults and
 * validation to every report, so a date range means the same thing
 * everywhere:
 *   - `dateTo` defaults to today, `dateFrom` to the start of the
 *     financial year containing `dateTo`, `asAt` to `dateTo`.
 *   - Dates must be ISO `YYYY-MM-DD`; `dateFrom` may not follow `dateTo`.
 *   - A report's required filter (e.g. the customer on a Statement) must
 *     be present — the viewer asks for it instead of rendering nothing.
 */

import { suggestFinancialYear } from "@/server/services/financial-year-service";
import { compareGlAccountCodes } from "@/server/general-ledger/types";
import type { ReportContext, ResolvedFilters } from "./kit";
import { REPORT_BY_ID } from "./registry";
import { ACCOUNT_TYPE_ORDER } from "./builders/shared";
import { memoizeSource, type ReportDataSource } from "./source";
import { DATE_FILTER_KEYS, REPORT_FILTER_KEYS, ReportInputError, type FilterSpec, type ReportFilters, type ReportResult } from "./types";

export class ReportNotFoundError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Only known filter keys survive; everything else in a URL is ignored. */
export function cleanFilters(raw: Record<string, string | string[] | undefined>): ReportFilters {
  const out: ReportFilters = {};
  for (const key of REPORT_FILTER_KEYS) {
    const value = raw[key];
    const v = (Array.isArray(value) ? value[0] : value)?.trim();
    if (v) out[key] = v;
  }
  return out;
}

export function filtersFromSearchParams(params: URLSearchParams): ReportFilters {
  const raw: Record<string, string> = {};
  params.forEach((value, key) => {
    raw[key] = value;
  });
  return cleanFilters(raw);
}

export async function financialYearStart(source: ReportDataSource, date: string, startMonth: number): Promise<string> {
  const years = await source.financialYears();
  const fy = years.find((y) => y.startDate <= date && date <= y.endDate);
  return fy?.startDate ?? suggestFinancialYear(date, startMonth).startDate;
}

export async function resolveFilters(source: ReportDataSource, reportId: string, raw: ReportFilters, today: string): Promise<ResolvedFilters> {
  const def = REPORT_BY_ID.get(reportId);
  if (!def) throw new ReportNotFoundError(`Unknown report "${reportId}".`);
  for (const key of DATE_FILTER_KEYS) {
    const v = raw[key];
    if (v !== undefined && (!ISO_DATE.test(v) || Number.isNaN(Date.parse(v)))) throw new ReportInputError(`"${v}" is not a valid date (use YYYY-MM-DD).`);
  }
  const company = await source.company();
  const dateTo = raw.dateTo ?? today;
  const dateFrom = raw.dateFrom ?? (await financialYearStart(source, dateTo, company.financialYearStartMonth));
  if (dateFrom > dateTo) throw new ReportInputError("The From date is after the To date.");
  const asAt = raw.asAt ?? dateTo;
  for (const spec of def.filters) {
    if (spec.required && !raw[spec.key]) throw new ReportInputError(`Choose ${/^[aeiou]/i.test(spec.label) ? "an" : "a"} ${spec.label.toLowerCase()} to run the ${def.title}.`);
  }
  return { ...raw, dateFrom, dateTo, asAt };
}

export async function runReport(source: ReportDataSource, reportId: string, raw: ReportFilters, today: string = todayIso()): Promise<{ result: ReportResult; filters: ResolvedFilters }> {
  const def = REPORT_BY_ID.get(reportId);
  if (!def) throw new ReportNotFoundError(`Unknown report "${reportId}".`);
  const memo = memoizeSource(source);
  const filters = await resolveFilters(memo, reportId, raw, today);
  const ctx: ReportContext = { source: memo, filters, company: await memo.company(), today };
  const body = await def.build(ctx);
  return { result: { reportId: def.id, title: def.title, generatedAt: new Date().toISOString(), ...body }, filters };
}

export type FilterOption = { value: string; label: string };

/** The choices for every select filter in `specs`, read from the same
 * source the reports read — never a hard-coded list of business data. */
export async function loadFilterOptions(source: ReportDataSource, specs: FilterSpec[]): Promise<Record<string, FilterOption[]>> {
  const out: Record<string, FilterOption[]> = {};
  await Promise.all(
    specs.map(async (spec) => {
      const o = spec.options;
      if (!o) return;
      if (typeof o === "object") {
        out[spec.key] = o.static;
        return;
      }
      switch (o) {
        case "customers":
          out[spec.key] = (await source.customers()).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: String(c.id), label: c.customerCode ? `${c.name} (${c.customerCode})` : c.name }));
          break;
        case "suppliers":
          out[spec.key] = (await source.suppliers()).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: String(s.id), label: s.supplierCode ? `${s.name} (${s.supplierCode})` : s.name }));
          break;
        case "accounts":
          out[spec.key] = (await source.accounts()).sort((a, b) => compareGlAccountCodes(a.accountCode, b.accountCode)).map((a) => ({ value: String(a.id), label: `${a.accountCode} ${a.description}${a.isActive ? "" : " (inactive)"}` }));
          break;
        case "accountTypes":
          out[spec.key] = ACCOUNT_TYPE_ORDER.map((t) => ({ value: t, label: t }));
          break;
        case "bankAccounts":
          out[spec.key] = (await source.bankAccounts()).map((b) => ({ value: String(b.id), label: `${b.accountName} — ${b.bankName} ${b.accountNumber}`.trim() }));
          break;
        case "vatCodes":
          out[spec.key] = (await source.vatTreatments()).map((t) => ({ value: t.code, label: `${t.code} (${t.rate}%)` }));
          break;
        case "stockItems":
          out[spec.key] = (await source.stockItems()).sort((a, b) => a.stockCode.localeCompare(b.stockCode, undefined, { numeric: true })).map((i) => ({ value: String(i.id), label: `${i.stockCode} ${i.description}` }));
          break;
        case "productCategories": {
          const categories = [...new Set((await source.stockItems()).map((i) => i.category || "Uncategorised stock"))].sort();
          out[spec.key] = [...categories, "Non-stock / services"].map((c) => ({ value: c, label: c }));
          break;
        }
        case "journals":
          out[spec.key] = (await source.journals())
            .sort((a, b) => (a.journalDate < b.journalDate ? 1 : a.journalDate > b.journalDate ? -1 : b.id - a.id))
            .slice(0, 1000)
            .map((j) => ({ value: String(j.id), label: `${j.journalNumber} · ${j.journalDate} · ${j.description || j.journalType}`.slice(0, 120) }));
          break;
        case "reconciliations": {
          const [recs, banks] = await Promise.all([source.bankReconciliations(), source.bankAccounts()]);
          const name = new Map(banks.map((b) => [b.id, b.accountName]));
          out[spec.key] = [...recs].sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1)).map((r) => ({ value: String(r.id), label: `${name.get(r.bankAccountId) ?? `Account #${r.bankAccountId}`} · statement ${r.statementDate} · ${r.status}` }));
          break;
        }
        case "importBatches":
          out[spec.key] = (await source.importBatches()).map((b) => ({ value: b.batchId, label: `${b.createdAt.slice(0, 10)} · ${b.sourceFilename || b.batchId}` }));
          break;
      }
    }),
  );
  return out;
}
