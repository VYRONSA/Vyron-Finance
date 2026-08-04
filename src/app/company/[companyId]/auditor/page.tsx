import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { AuditorTabs } from "@/components/financial/audit/auditor-tabs";
import { IconAlertTriangle, IconFileText, IconImport, IconShieldCheck } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { listFinancialYears, suggestFinancialYear } from "@/server/services/financial-year-service";
import { listJournals } from "@/server/services/journal-workflow-service";
import { listAuditEngagements, listAuditAreas, listAuditProgrammeSteps, listAuditRiskRegister, listAuditTeamAssignments } from "@/server/services/audit-engagement-service";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import { listAuditWorkingPapers } from "@/server/services/audit-working-paper-service";
import { listAuditQueries } from "@/server/services/audit-query-service";
import { getExecutiveIntelligence } from "@/server/services/executive-intelligence-service";
import { answerMissingSupportingDocuments } from "@/server/audit/audit-assistant-engine";
import { buildAuditDashboardSummary } from "@/server/services/audit-dashboard-summary-service";
import { MOCK_COMPANIES_FULL, MOCK_FINANCIAL_YEARS } from "@/lib/mock/company-management-data";
import { MOCK_AUDIT_ENGAGEMENTS, MOCK_AUDIT_AREAS, MOCK_AUDIT_PROGRAMME_STEPS, MOCK_AUDIT_RISK_REGISTER, MOCK_AUDIT_TEAM_ASSIGNMENTS, MOCK_AUDIT_FINDINGS, MOCK_AUDIT_WORKING_PAPERS, MOCK_AUDIT_QUERIES } from "@/lib/mock/audit-data";
import { MOCK_JOURNALS } from "@/lib/mock/general-ledger-data";
import { MOCK_AUDIT_READINESS_SCORE } from "@/lib/mock/financial-reporting-data";
import type { AuditProgrammeStep } from "@/server/audit/types";

export const metadata: Metadata = {
  title: "Auditor Workspace — VYRON FINANCE",
};

export default async function AuditorPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const company = previewMode ? MOCK_COMPANIES_FULL.find((c) => c.id === companyId) : await getCompany(companyId);
  if (!company) notFound();

  const financialYears = previewMode ? MOCK_FINANCIAL_YEARS : await listFinancialYears(companyId);
  const today = new Date().toISOString().slice(0, 10);
  const currentFinancialYear = financialYears.find((fy) => fy.isCurrent) ?? null;
  const financialYearStartDate = currentFinancialYear?.startDate ?? suggestFinancialYear(today, company.financialYearStartMonth).startDate;
  const periodStart = `${today.slice(0, 7)}-01`;
  const periodEnd = today;

  const engagements = previewMode ? MOCK_AUDIT_ENGAGEMENTS : await listAuditEngagements(companyId);
  const engagement = engagements.find((e) => e.status !== "Complete") ?? engagements[0] ?? null;

  const [areas, risks, team, findings, workingPapers, queries, journals, executiveIntelligence] = previewMode
    ? [MOCK_AUDIT_AREAS, MOCK_AUDIT_RISK_REGISTER, MOCK_AUDIT_TEAM_ASSIGNMENTS, MOCK_AUDIT_FINDINGS, MOCK_AUDIT_WORKING_PAPERS, MOCK_AUDIT_QUERIES, MOCK_JOURNALS, null]
    : await Promise.all([
        engagement ? listAuditAreas(companyId, engagement.id) : Promise.resolve([]),
        engagement ? listAuditRiskRegister(companyId, engagement.id) : Promise.resolve([]),
        engagement ? listAuditTeamAssignments(companyId, engagement.id) : Promise.resolve([]),
        listAuditFindings(companyId, engagement ? { engagementId: engagement.id } : {}),
        listAuditWorkingPapers(companyId, engagement?.id),
        listAuditQueries(companyId),
        listJournals(companyId),
        getExecutiveIntelligence(companyId, periodStart, periodEnd, financialYearStartDate),
      ]);

  const programmeStepsList = previewMode
    ? MOCK_AUDIT_PROGRAMME_STEPS
    : (await Promise.all(areas.map((a) => listAuditProgrammeSteps(companyId, a.id)))).flat();
  const programmeStepsByArea = programmeStepsList.reduce<Record<number, AuditProgrammeStep[]>>((acc, step) => {
    acc[step.areaId] = [...(acc[step.areaId] ?? []), step];
    return acc;
  }, {});

  const auditReadinessScore = executiveIntelligence?.auditReadinessScore ?? MOCK_AUDIT_READINESS_SCORE;
  const missingDocumentsCount = answerMissingSupportingDocuments(journals.map((j) => ({ id: j.id, journalNumber: j.journalNumber, sourceType: j.sourceType, reference: j.reference }))).supportingTransactions.length;
  const summary = buildAuditDashboardSummary(findings, auditReadinessScore, missingDocumentsCount);

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
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">Auditor Workspace & Audit Intelligence</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Auditor Workspace</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Automated evidence gathering, anomaly detection, reconciliations, and working paper preparation —
              professional judgement always stays with the auditor.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "auditReadiness", label: "Audit Readiness Score", value: `${summary.auditReadinessScore}%`, icon: IconShieldCheck },
          { key: "materialIssues", label: "Material Issues", value: String(summary.materialIssuesCount), icon: IconAlertTriangle },
          { key: "outstandingExceptions", label: "Outstanding Exceptions", value: String(summary.outstandingExceptionsCount), icon: IconAlertTriangle },
          { key: "missingDocuments", label: "Missing Documents", value: String(summary.missingDocumentsCount), icon: IconFileText },
          { key: "journalRisk", label: "Journal Risk", value: String(summary.journalRiskCount), icon: IconAlertTriangle },
          { key: "goingConcern", label: "Going Concern Indicators", value: String(summary.goingConcernIndicatorCount), icon: IconAlertTriangle },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample audit data. Every action is disabled until Supabase is configured.
        </p>
      )}

      <AuditorTabs
        companyId={companyId}
        engagement={engagement}
        summary={summary}
        areas={areas}
        programmeStepsByArea={programmeStepsByArea}
        risks={risks}
        team={team}
        findings={findings}
        workingPapers={workingPapers}
        queries={queries}
        periodStart={periodStart}
        periodEnd={periodEnd}
        financialYearStartDate={financialYearStartDate}
        previewMode={previewMode}
      />
    </div>
  );
}
