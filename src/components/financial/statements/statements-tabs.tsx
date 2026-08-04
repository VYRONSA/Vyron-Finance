"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { StatementsNotesTab } from "./statements-notes-tab";
import { ReportingPackagesTab } from "./reporting-packages-tab";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { BalanceSheet } from "@/server/reporting/balance-sheet-engine";
import type { CashFlowStatement } from "@/server/reporting/cash-flow-engine";
import type { StatementOfChangesInEquity } from "@/server/reporting/equity-engine";
import type { DisclosureNote, ReportingPackage } from "@/server/disclosures/types";

const TABS = ["Statements & Notes", "Reporting Packages"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/\s+&\s+|\s+/g, "-") === slug);
  return found ?? "Statements & Notes";
}

export function StatementsTabs({
  companyId,
  incomeStatement,
  balanceSheet,
  cashFlowStatement,
  equityStatement,
  disclosureNotes,
  reportingPackages,
  periodStart,
  periodEnd,
  financialYearStartDate,
  financialYearLabel,
  previewMode,
}: {
  companyId: string;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashFlowStatement: CashFlowStatement;
  equityStatement: StatementOfChangesInEquity;
  disclosureNotes: DisclosureNote[];
  reportingPackages: ReportingPackage[];
  periodStart: string;
  periodEnd: string;
  financialYearStartDate: string;
  financialYearLabel: string;
  previewMode: boolean;
}) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromSlug(searchParams.get("tab")));

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
        {activeTab === "Statements & Notes" && (
          <StatementsNotesTab
            companyId={companyId}
            incomeStatement={incomeStatement}
            balanceSheet={balanceSheet}
            cashFlowStatement={cashFlowStatement}
            equityStatement={equityStatement}
            disclosureNotes={disclosureNotes}
            periodStart={periodStart}
            periodEnd={periodEnd}
            financialYearStartDate={financialYearStartDate}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Reporting Packages" && (
          <ReportingPackagesTab
            companyId={companyId}
            packages={reportingPackages}
            periodStart={periodStart}
            periodEnd={periodEnd}
            financialYearStartDate={financialYearStartDate}
            financialYearLabel={financialYearLabel}
            previewMode={previewMode}
          />
        )}
      </CardContent>
    </Card>
  );
}
