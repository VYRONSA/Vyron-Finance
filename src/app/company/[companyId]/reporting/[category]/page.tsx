import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { ReportWorkspace } from "@/components/financial/reporting/report-workspace";
import { CATEGORY_INFO } from "@/components/financial/reporting/categories";
import { catalogEntry, REPORT_BY_ID, reportHomeMap, reportsInCategory } from "@/server/report-centre/registry";
import { cleanFilters, financialYearStart, loadFilterOptions, runReport, todayIso } from "@/server/report-centre/run";
import { reportSourceForCompany } from "@/server/report-centre/source-for-company";
import { isReportCategory, REPORT_CATEGORIES, ReportInputError, type ReportFilters, type ReportResult } from "@/server/report-centre/types";

type Props = { params: Promise<{ companyId: string; category: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { category } = await params;
  const sp = await searchParams;
  const reportId = typeof sp.report === "string" ? sp.report : null;
  const report = reportId ? REPORT_BY_ID.get(reportId) : undefined;
  const label = isReportCategory(category) ? CATEGORY_INFO[category].label : "Reporting";
  return { title: `${report ? `${report.title} — ` : ""}${label} Reports — VYRON FINANCE` };
}

export default async function ReportingCategoryPage({ params, searchParams }: Props) {
  const { companyId, category } = await params;
  if (!isReportCategory(category)) notFound();
  const sp = await searchParams;
  const reportId = typeof sp.report === "string" ? sp.report : null;
  const reports = reportsInCategory(category);
  const def = reportId ? REPORT_BY_ID.get(reportId) : undefined;
  const selected = def ? catalogEntry(def) : null;

  const source = reportSourceForCompany(companyId);
  const today = todayIso();
  let filters: ReportFilters = cleanFilters(sp);
  let result: ReportResult | null = null;
  let inputError: string | null = null;
  if (selected) {
    try {
      const run = await runReport(source, selected.id, filters, today);
      result = run.result;
      filters = run.filters;
    } catch (error) {
      if (!(error instanceof ReportInputError)) throw error;
      inputError = error.message;
    }
  }
  const [options, company] = await Promise.all([selected ? loadFilterOptions(source, selected.filters) : Promise.resolve({}), source.company()]);
  const fyStart = await financialYearStart(source, today, company.financialYearStartMonth);
  const info = CATEGORY_INFO[category];
  const Icon = info.icon;

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-3 print:hidden">
        <nav aria-label="Breadcrumb" className="text-xs text-vf-ink-faint">
          <Link href={`/company/${companyId}/reporting`} className="hover:text-vf-red-600">
            Reporting Centre
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-vf-ink-soft">{info.label}</span>
          {selected && (
            <>
              <span className="mx-1.5">/</span>
              <span className="text-vf-ink-soft">{selected.title}</span>
            </>
          )}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-vf-md bg-gradient-to-br from-vf-red-600 to-vf-red-900 text-vf-on-dark shadow-vf-red-glow">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-semibold text-vf-ink">{info.label} Reports</h1>
              <p className="max-w-[80ch] text-sm text-vf-ink-faint">{info.description}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="navigation" aria-label="Report areas">
          {REPORT_CATEGORIES.map((c) => (
            <Link
              key={c}
              href={`/company/${companyId}/reporting/${c}`}
              aria-current={c === category ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                c === category ? "border-vf-red-600 bg-vf-red-500/10 text-vf-red-600" : "border-vf-paper-border text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600",
              )}
            >
              {CATEGORY_INFO[c].label}
            </Link>
          ))}
        </div>
      </div>

      <ReportWorkspace
        companyId={companyId}
        category={category}
        reports={reports}
        selected={selected}
        result={result}
        inputError={inputError}
        filters={filters}
        filterOptions={options}
        reportHome={reportHomeMap()}
        today={today}
        fyStart={fyStart}
        previewMode={!isSupabaseConfigured()}
      />
    </div>
  );
}
