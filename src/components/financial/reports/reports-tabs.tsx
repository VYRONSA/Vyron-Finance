"use client";

import { useUrlParam } from "@/hooks/use-url-param";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { FinancialStatementsTab } from "./financial-statements-tab";
import { ManagementReportsTab } from "./management-reports-tab";
import { ForecastingTab } from "./forecasting-tab";
import { ExecutiveAlertsTab } from "./executive-alerts-tab";
import { ReportDesignerTab } from "./report-designer-tab";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import type { ForecastResult } from "@/server/reporting/forecast-engine";
import type { Budget, ExecutiveAlert, ReportDefinition } from "@/server/reporting/types";
import type { Branch, CostCentre, Department, Project } from "@/server/company-management/types";

const TABS = ["Financial Statements", "Management Reports", "Forecasting", "Executive Alerts", "Report Designer"] as const;
type Tab = (typeof TABS)[number];

function slugFromTab(tab: Tab): string {
  return tab.toLowerCase().replace(/\s+/g, "-");
}

function tabFromSlug(slug: string): Tab {
  const found = TABS.find((t) => slugFromTab(t) === slug);
  return found ?? "Financial Statements";
}

export function ReportsTabs({
  companyId,
  incomeStatement,
  balanceSheet,
  cashFlowStatement,
  financialYearLabel,
  budgets,
  accounts,
  cashAccounts,
  branches,
  departments,
  costCentres,
  projects,
  forecasts,
  executiveAlerts,
  reportDefinitions,
  previewMode,
}: {
  companyId: string;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashFlowStatement: CashFlowStatement;
  financialYearLabel: string;
  budgets: Budget[];
  accounts: ChartOfAccount[];
  cashAccounts: ChartOfAccount[];
  branches: Branch[];
  departments: Department[];
  costCentres: CostCentre[];
  projects: Project[];
  forecasts: {
    cashflow: ForecastResult;
    revenue: ForecastResult;
    expense: ForecastResult;
    vat: ForecastResult;
    inventory: ForecastResult;
    customerPayment: ForecastResult;
    supplierPayment: ForecastResult;
  };
  executiveAlerts: ExecutiveAlert[];
  reportDefinitions: ReportDefinition[];
  previewMode: boolean;
}) {
  // Finding #196 (RC-5) — the active tab survives a refresh and
  // participates in Back/Forward instead of resetting on every navigation.
  const [tabSlug, setTabSlug] = useUrlParam("tab", slugFromTab("Financial Statements"));
  const activeTab = tabFromSlug(tabSlug);
  const setActiveTab = (tab: Tab) => setTabSlug(slugFromTab(tab));

  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-vf-paper-border px-4 pt-3">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? "page" : undefined}
            className={cn(
              "rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
              activeTab === tab ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <CardContent className="pt-5">
        {activeTab === "Financial Statements" && (
          <FinancialStatementsTab companyId={companyId} incomeStatement={incomeStatement} balanceSheet={balanceSheet} cashFlowStatement={cashFlowStatement} cashAccounts={cashAccounts} />
        )}
        {activeTab === "Management Reports" && (
          <ManagementReportsTab
            companyId={companyId}
            financialYearLabel={financialYearLabel}
            budgets={budgets}
            accounts={accounts}
            branches={branches}
            departments={departments}
            costCentres={costCentres}
            projects={projects}
            actualSections={[incomeStatement.revenue, incomeStatement.costOfSales, incomeStatement.operatingExpenses]}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Forecasting" && <ForecastingTab {...forecasts} />}
        {activeTab === "Executive Alerts" && <ExecutiveAlertsTab companyId={companyId} alerts={executiveAlerts} previewMode={previewMode} />}
        {activeTab === "Report Designer" && <ReportDesignerTab companyId={companyId} reportDefinitions={reportDefinitions} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
