import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportsTabs } from "@/components/financial/reports/reports-tabs";
import { IconBanknote, IconImport, IconShieldCheck, IconTarget } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { listFinancialYears, suggestFinancialYear } from "@/server/services/financial-year-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getIncomeStatement, getBalanceSheet, getCashFlowStatement } from "@/server/services/financial-statements-service";
import {
  getCashflowForecast,
  getCustomerPaymentForecast,
  getExpenseForecast,
  getInventoryForecast,
  getRevenueForecast,
  getSupplierPaymentForecast,
  getVatForecast,
} from "@/server/services/forecast-service";
import { listBudgets } from "@/server/services/budget-service";
import { listReportDefinitions } from "@/server/services/report-definition-service";
import { listExecutiveAlerts } from "@/server/services/executive-alert-service";
import { getExecutiveIntelligence } from "@/server/services/executive-intelligence-service";
import { MOCK_CHART_OF_ACCOUNTS } from "@/lib/mock/general-ledger-data";
import { MOCK_COMPANIES_FULL, MOCK_FINANCIAL_YEARS } from "@/lib/mock/company-management-data";
import {
  MOCK_BALANCE_SHEET,
  MOCK_BUDGETS,
  MOCK_CASHFLOW_FORECAST,
  MOCK_CASH_FLOW_STATEMENT,
  MOCK_EXECUTIVE_ALERTS,
  MOCK_INCOME_STATEMENT,
  MOCK_REPORT_DEFINITIONS,
  MOCK_REVENUE_FORECAST,
} from "@/lib/mock/financial-reporting-data";

export const metadata: Metadata = {
  title: "Reports — VYRON FINANCE",
};

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function ReportsPage({ params }: { params: Promise<{ companyId: string }> }) {
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

  const [accounts, incomeStatement, balanceSheet, cashFlowStatement, forecastResults, budgets, reportDefinitions, executiveAlerts, executiveIntelligence] = previewMode
    ? [
        MOCK_CHART_OF_ACCOUNTS,
        MOCK_INCOME_STATEMENT,
        MOCK_BALANCE_SHEET,
        MOCK_CASH_FLOW_STATEMENT,
        {
          cashflow: MOCK_CASHFLOW_FORECAST,
          revenue: MOCK_REVENUE_FORECAST,
          expense: MOCK_REVENUE_FORECAST,
          vat: MOCK_CASHFLOW_FORECAST,
          inventory: MOCK_CASHFLOW_FORECAST,
          customerPayment: { method: "linear-regression" as const, historicalPoints: 0, confidence: 0, forecast: [], assumptions: ["Preview Mode has no historical invoice/receipt data to fit a trend from."] },
          supplierPayment: { method: "linear-regression" as const, historicalPoints: 0, confidence: 0, forecast: [], assumptions: ["Preview Mode has no historical bill/payment data to fit a trend from."] },
        },
        MOCK_BUDGETS,
        MOCK_REPORT_DEFINITIONS,
        MOCK_EXECUTIVE_ALERTS,
        null,
      ]
    : await Promise.all([
        listChartOfAccounts(companyId),
        getIncomeStatement(companyId, periodStart, today),
        getBalanceSheet(companyId, today, financialYearStartDate),
        getCashFlowStatement(companyId, periodStart, today),
        Promise.all([
          getCashflowForecast(companyId, today),
          getRevenueForecast(companyId, today),
          getExpenseForecast(companyId, today),
          getVatForecast(companyId, today),
          getInventoryForecast(companyId, today),
          getCustomerPaymentForecast(companyId, today),
          getSupplierPaymentForecast(companyId, today),
        ]).then(([cashflow, revenue, expense, vat, inventory, customerPayment, supplierPayment]) => ({ cashflow, revenue, expense, vat, inventory, customerPayment, supplierPayment })),
        listBudgets(companyId, financialYearLabel),
        listReportDefinitions(companyId),
        listExecutiveAlerts(companyId),
        getExecutiveIntelligence(companyId, periodStart, today, financialYearStartDate),
      ]);

  const scores = executiveIntelligence
    ? {
        financialHealthScore: executiveIntelligence.financialHealthScore,
        businessRiskScore: executiveIntelligence.businessRiskScore,
        auditReadinessScore: executiveIntelligence.auditReadinessScore,
        complianceScorePercent: executiveIntelligence.complianceScorePercent,
      }
    : { financialHealthScore: 84, businessRiskScore: 18, auditReadinessScore: 88, complianceScorePercent: 92 };

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
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Financial Reporting & Executive Intelligence</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Reports</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Financial Statements generated directly from the General Ledger, Management Reports, transparent
              Forecasts, and Executive Alerts — every figure traceable back to its source transaction.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "netProfit", label: `Net Profit (${incomeStatement.periodStart} — ${incomeStatement.periodEnd})`, value: money(incomeStatement.netProfit), icon: IconBanknote },
          { key: "financialHealth", label: "Financial Health Score", value: `${scores.financialHealthScore}%`, icon: IconShieldCheck },
          { key: "businessRisk", label: "Business Risk Score", value: `${scores.businessRiskScore}%`, icon: IconTarget },
          { key: "auditReadiness", label: "Audit Readiness Score", value: `${scores.auditReadinessScore}%`, icon: IconShieldCheck },
          { key: "compliance", label: "Compliance Score", value: `${scores.complianceScorePercent}%`, icon: IconShieldCheck },
          { key: "openAlerts", label: "Open Executive Alerts", value: String(executiveAlerts.filter((a) => a.status === "Open").length), icon: IconTarget },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — statements below are computed by the real Financial Reporting engines from a small sample ledger. Every action is disabled until Supabase is configured.
        </p>
      )}

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-vf-md" />}>
        <ReportsTabs
          companyId={companyId}
          incomeStatement={incomeStatement}
          balanceSheet={balanceSheet}
          cashFlowStatement={cashFlowStatement}
          financialYearLabel={financialYearLabel}
          budgets={budgets}
          accounts={accounts}
          forecasts={forecastResults}
          executiveAlerts={executiveAlerts}
          reportDefinitions={reportDefinitions}
          previewMode={previewMode}
        />
      </Suspense>
    </div>
  );
}
