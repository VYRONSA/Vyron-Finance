import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { CopilotTabs } from "@/components/financial/copilot/copilot-tabs";
import { IconImport, IconShieldCheck, IconSparkles, IconTarget } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getCompany } from "@/server/services/company-service";
import { listFinancialYears, suggestFinancialYear } from "@/server/services/financial-year-service";
import { listFixedAssets } from "@/server/services/asset-register-service";
import { listCopilotNarratives } from "@/server/services/narrative-service";
import { listCopilotScenarios } from "@/server/services/scenario-service";
import { listCopilotBriefings } from "@/server/services/executive-briefing-service";
import { MOCK_COMPANIES_FULL, MOCK_FINANCIAL_YEARS } from "@/lib/mock/company-management-data";
import { MOCK_FIXED_ASSETS } from "@/lib/mock/asset-data";
import { MOCK_COPILOT_BRIEFING, MOCK_COPILOT_NARRATIVES, MOCK_COPILOT_SCENARIOS } from "@/lib/mock/copilot-data";
import type { ExecutiveBriefing } from "@/server/copilot/executive-briefing-engine";

export const metadata: Metadata = {
  title: "AI Executive Copilot — VYRON FINANCE",
};

export default async function CopilotPage({ params }: { params: Promise<{ companyId: string }> }) {
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

  const [fixedAssets, narratives, scenarios, briefings] = previewMode
    ? [MOCK_FIXED_ASSETS, MOCK_COPILOT_NARRATIVES, MOCK_COPILOT_SCENARIOS, [MOCK_COPILOT_BRIEFING]]
    : await Promise.all([listFixedAssets(companyId), listCopilotNarratives(companyId), listCopilotScenarios(companyId), listCopilotBriefings(companyId)]);

  const assetOptions = fixedAssets.map((a) => ({ id: a.id, assetNumber: a.assetNumber, description: a.description }));
  const latestBriefing = previewMode ? MOCK_COPILOT_BRIEFING : (briefings[0] ?? null);
  const latestFinancialHealthScore = latestBriefing ? (latestBriefing.content as unknown as ExecutiveBriefing).financialHealth.score : null;

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
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">AI Executive Copilot & Financial Intelligence</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Executive Copilot</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              Ask a question, generate a narrative, model a what-if scenario, or pull today&apos;s briefing — every answer is evidence-backed and
              traceable to live data. A consumer of the existing intelligence layer, never a replacement for it.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "narratives", label: "Narratives Generated", value: String(narratives.length), icon: IconSparkles },
          { key: "scenarios", label: "Scenarios Modeled", value: String(scenarios.length), icon: IconTarget },
          { key: "financialHealth", label: "Financial Health", value: latestFinancialHealthScore !== null ? `${latestFinancialHealthScore}%` : "—", icon: IconShieldCheck },
        ]}
      />

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample Copilot data. Every action is disabled until Supabase is configured.
        </p>
      )}

      <CopilotTabs
        companyId={companyId}
        narratives={narratives}
        scenarios={scenarios}
        briefing={latestBriefing}
        assetOptions={assetOptions}
        periodStart={periodStart}
        periodEnd={periodEnd}
        financialYearStartDate={financialYearStartDate}
        financialYearLabel={financialYearLabel}
        previewMode={previewMode}
      />
    </div>
  );
}
