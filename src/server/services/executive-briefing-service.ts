/**
 * Application Service for the daily Executive Briefing — composes real,
 * already-computed scores from `executive-intelligence-service.ts`
 * (Module 9), `asset-dashboard-summary-service.ts` (Module 11), and
 * `forecast-service.ts` (Module 9's cash trend), then hands them to the
 * pure `executive-briefing-engine.ts`. Persists one real artifact per
 * company per day.
 */

import { getExecutiveIntelligence } from "@/server/services/executive-intelligence-service";
import { getCashFlowStatement } from "@/server/services/financial-statements-service";
import { getCashflowForecast } from "@/server/services/forecast-service";
import { listFixedAssets } from "@/server/services/asset-register-service";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import { buildAssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import { buildExecutiveBriefing, type BriefingSignal } from "@/server/copilot/executive-briefing-engine";
import * as repo from "@/server/repositories/copilot-briefing-repository";
import type { CopilotBriefing } from "@/server/copilot/types";

export const listCopilotBriefings = repo.listCopilotBriefings;
export const getCopilotBriefingForDate = repo.getCopilotBriefingForDate;

export async function generateExecutiveBriefing(companyId: string, briefingDate: string, financialYearStartDate: string, generatedBy: string): Promise<CopilotBriefing> {
  const monthStart = `${briefingDate.slice(0, 7)}-01`;

  const [executiveIntelligence, cashFlow, cashForecast, assets, assetFindings, auditFindings] = await Promise.all([
    getExecutiveIntelligence(companyId, monthStart, briefingDate, financialYearStartDate),
    getCashFlowStatement(companyId, monthStart, briefingDate),
    getCashflowForecast(companyId, briefingDate),
    listFixedAssets(companyId),
    listAssetFindings(companyId, { status: "Open" }),
    listAuditFindings(companyId, { status: "Open" }),
  ]);

  const assetSummary = buildAssetDashboardSummary(assets, assetFindings, 0);
  const cashTrendImproving = cashForecast.forecast.length === 0 || cashForecast.forecast[cashForecast.forecast.length - 1].value >= cashForecast.forecast[0].value;

  const signals: BriefingSignal[] = [
    ...executiveIntelligence.signals.map((s) => ({ label: s.message, confidence: s.confidence, source: s.source })),
    ...auditFindings.map((f) => ({ label: f.reason, confidence: f.confidence, source: "Audit" })),
    ...assetFindings.map((f) => ({ label: f.reason, confidence: f.confidence, source: "Assets" })),
  ];
  if (cashTrendImproving && executiveIntelligence.financialHealthScore >= 70) {
    signals.push({ label: `Financial Health Score is ${executiveIntelligence.financialHealthScore}% with an improving cash trend.`, confidence: 0.6, source: "Financial", isOpportunity: true });
  }

  const briefing = buildExecutiveBriefing({
    financialHealthScore: executiveIntelligence.financialHealthScore,
    businessRiskScore: executiveIntelligence.businessRiskScore,
    auditReadinessScore: executiveIntelligence.auditReadinessScore,
    complianceScorePercent: executiveIntelligence.complianceScorePercent,
    assetHealthScore: assetSummary.assetHealthScore,
    cashPosition: cashFlow.closingCash,
    cashTrendImproving,
    signals,
  });

  return repo.upsertCopilotBriefing(companyId, briefingDate, briefing, generatedBy);
}
