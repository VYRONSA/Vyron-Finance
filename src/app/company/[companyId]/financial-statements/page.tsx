import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatementsTabs } from "@/components/financial/statements/statements-tabs";
import { IconFileText, IconImport, IconShieldCheck, IconSparkles } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { listFinancialYears, suggestFinancialYear } from "@/server/services/financial-year-service";
import { getBalanceSheet, getCashFlowStatement, getIncomeStatement, getStatementOfChangesInEquity } from "@/server/services/financial-statements-service";
import { listDisclosureNotes } from "@/server/services/disclosure-service";
import { listReportingPackages } from "@/server/services/reporting-package-service";
import { getReportingReadiness } from "@/server/services/reporting-readiness-service";
import { MOCK_COMPANIES_FULL, MOCK_FINANCIAL_YEARS } from "@/lib/mock/company-management-data";
import { MOCK_BALANCE_SHEET, MOCK_CASH_FLOW_STATEMENT, MOCK_INCOME_STATEMENT } from "@/lib/mock/financial-reporting-data";
import { MOCK_DISCLOSURE_NOTES, MOCK_REPORTING_PACKAGES, MOCK_REPORTING_READINESS, MOCK_STATEMENT_OF_CHANGES_IN_EQUITY } from "@/lib/mock/financial-statements-data";

export const metadata: Metadata = {
  title: "Financial Statements — VYRON FINANCE",
};

export default async function FinancialStatementsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const company = previewMode ? MOCK_COMPANIES_FULL.find((c) => c.id === companyId) : await getCompany(companyId);
  if (!company) notFound();

  const financialYears = previewMode ? MOCK_FINANCIAL_YEARS : await listFinancialYears(companyId);
  const today = new Date().toISOString().slice(0, 10);
  const currentFinancialYear = financialYears.find((fy) => fy.isCurrent) ?? null;
  const financialYearStartDate = currentFinancialYear?.startDate ?? suggestFinancialYear(today, company.financialYearStartMonth).startDate;
  const financialYearLabel = currentFinancialYear?.yearLabel ?? suggestFinancialYear(today, company.financialYearStartMonth).yearLabel;
  const periodStart = `${today.slice(0, 7)}-01`;
  const periodEnd = today;

  const [incomeStatement, balanceSheet, cashFlowStatement, equityStatement, disclosureNotes, reportingPackages, readiness] = previewMode
    ? [MOCK_INCOME_STATEMENT, MOCK_BALANCE_SHEET, MOCK_CASH_FLOW_STATEMENT, MOCK_STATEMENT_OF_CHANGES_IN_EQUITY, MOCK_DISCLOSURE_NOTES, MOCK_REPORTING_PACKAGES, MOCK_REPORTING_READINESS]
    : await Promise.all([
        getIncomeStatement(companyId, periodStart, periodEnd),
        getBalanceSheet(companyId, periodEnd, financialYearStartDate),
        getCashFlowStatement(companyId, periodStart, periodEnd),
        getStatementOfChangesInEquity(companyId, financialYearStartDate, periodEnd, financialYearStartDate),
        listDisclosureNotes(companyId, periodStart, periodEnd),
        listReportingPackages(companyId),
        getReportingReadiness(companyId, periodStart, periodEnd, financialYearStartDate),
      ]);

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">GAAP-Compliant Financial Statements & Disclosure Engine</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Financial Statements</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Professional, standards-compliant financial reporting with complete audit traceability — every figure drills through to its General
              Ledger account, journal, and supporting audit evidence.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "statementsGenerated", label: "Financial Statements Generated", value: String(readiness.financialStatementsGeneratedCount), icon: IconFileText },
          { key: "reportingStatus", label: "Reporting Status", value: readiness.status, icon: IconSparkles },
          { key: "outstandingDisclosures", label: "Outstanding Disclosures", value: String(readiness.outstandingDisclosureCount), icon: IconFileText },
          { key: "auditCompletion", label: "Audit Completion", value: `${readiness.auditReadinessScore}%`, icon: IconShieldCheck },
          { key: "reportingReadiness", label: "Reporting Readiness", value: `${readiness.score}%`, icon: IconShieldCheck },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample financial statements. Every action is disabled until Supabase is configured.
        </p>
      )}

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-vf-md" />}>
        <StatementsTabs
          companyId={companyId}
          incomeStatement={incomeStatement}
          balanceSheet={balanceSheet}
          cashFlowStatement={cashFlowStatement}
          equityStatement={equityStatement}
          disclosureNotes={disclosureNotes}
          reportingPackages={reportingPackages}
          periodStart={periodStart}
          periodEnd={periodEnd}
          financialYearStartDate={financialYearStartDate}
          financialYearLabel={financialYearLabel}
          previewMode={previewMode}
        />
      </Suspense>
    </div>
  );
}
