"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { AuditorDashboardTab } from "./auditor-dashboard-tab";
import { AuditPlanningTab } from "./audit-planning-tab";
import { AuditFindingsTab } from "./audit-findings-tab";
import { AuditWorkingPapersTab } from "./audit-working-papers-tab";
import { AuditAssistantTab } from "./audit-assistant-tab";
import { AuditQueriesTab } from "./audit-queries-tab";
import type { AuditArea, AuditEngagement, AuditFinding, AuditProgrammeStep, AuditQuery, AuditRiskRegisterEntry, AuditTeamAssignment, AuditWorkingPaper } from "@/server/audit/types";
import type { AuditDashboardSummary } from "@/server/services/audit-dashboard-summary-service";

const TABS = ["Dashboard", "Planning", "Findings", "Working Papers", "Assistant", "Queries"] as const;
type Tab = (typeof TABS)[number];

function tabFromSlug(slug: string | null): Tab {
  const found = TABS.find((t) => t.toLowerCase().replace(/\s+/g, "-") === slug);
  return found ?? "Dashboard";
}

export function AuditorTabs({
  companyId,
  engagement,
  summary,
  areas,
  programmeStepsByArea,
  risks,
  team,
  findings,
  workingPapers,
  queries,
  periodStart,
  periodEnd,
  financialYearStartDate,
  previewMode,
}: {
  companyId: string;
  engagement: AuditEngagement | null;
  summary: AuditDashboardSummary;
  areas: AuditArea[];
  programmeStepsByArea: Record<number, AuditProgrammeStep[]>;
  risks: AuditRiskRegisterEntry[];
  team: AuditTeamAssignment[];
  findings: AuditFinding[];
  workingPapers: AuditWorkingPaper[];
  queries: AuditQuery[];
  periodStart: string;
  periodEnd: string;
  financialYearStartDate: string;
  previewMode: boolean;
}) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromSlug(searchParams.get("tab")));
  const engagementId = engagement?.id ?? null;
  const materialityThreshold = engagement?.performanceMateriality || 50000;

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
        {activeTab === "Dashboard" && <AuditorDashboardTab summary={summary} findingsHref={`/company/${companyId}/auditor?tab=findings`} />}
        {activeTab === "Planning" &&
          (engagement ? (
            <AuditPlanningTab companyId={companyId} engagement={engagement} areas={areas} programmeStepsByArea={programmeStepsByArea} risks={risks} team={team} previewMode={previewMode} />
          ) : (
            <p className="text-sm text-vf-ink-faint">No audit engagement exists yet.</p>
          ))}
        {activeTab === "Findings" && (
          <AuditFindingsTab
            companyId={companyId}
            engagementId={engagementId}
            findings={findings}
            periodStart={periodStart}
            periodEnd={periodEnd}
            materialityThreshold={materialityThreshold}
            financialYearStartDate={financialYearStartDate}
            previewMode={previewMode}
          />
        )}
        {activeTab === "Working Papers" && (
          <AuditWorkingPapersTab companyId={companyId} engagementId={engagementId} workingPapers={workingPapers} periodStart={periodStart} periodEnd={periodEnd} previewMode={previewMode} />
        )}
        {activeTab === "Assistant" && (
          <AuditAssistantTab companyId={companyId} periodStart={periodStart} periodEnd={periodEnd} performanceMateriality={materialityThreshold} previewMode={previewMode} />
        )}
        {activeTab === "Queries" && <AuditQueriesTab companyId={companyId} queries={queries} periodStart={periodStart} periodEnd={periodEnd} previewMode={previewMode} />}
      </CardContent>
    </Card>
  );
}
