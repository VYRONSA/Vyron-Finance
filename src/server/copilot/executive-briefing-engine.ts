/**
 * The Executive Briefing composer — pure, no Supabase, zero new
 * calculation. Every score here is composed from an ALREADY-COMPUTED
 * real value (Financial Health/Business Risk/Audit Readiness/Compliance
 * from `executive-intelligence-service.ts`, Asset Health from
 * `asset-dashboard-summary-service.ts`) — this file only bands them into
 * a label, ranks the real signals it's handed, and assembles the
 * required sections. "Every statement must be traceable to live data":
 * every sentence in the output either restates a real number the caller
 * passed in, or is generated from a real signal list — nothing is
 * invented.
 */

export type ScoreBand = { score: number; label: "Strong" | "Adequate" | "Weak" | "Critical" };

function bandScore(score: number, direction: "higherIsBetter" | "lowerIsBetter" = "higherIsBetter"): ScoreBand {
  const effective = direction === "higherIsBetter" ? score : 100 - score;
  const label: ScoreBand["label"] = effective >= 80 ? "Strong" : effective >= 60 ? "Adequate" : effective >= 40 ? "Weak" : "Critical";
  return { score, label };
}

export type BriefingSignal = { label: string; confidence: number; source: string; isOpportunity?: boolean };

export type ExecutiveBriefingInputs = {
  financialHealthScore: number;
  businessRiskScore: number;
  auditReadinessScore: number;
  complianceScorePercent: number;
  assetHealthScore: number;
  cashPosition: number;
  cashTrendImproving: boolean;
  signals: BriefingSignal[];
};

export type ExecutiveBriefing = {
  financialHealth: ScoreBand;
  businessRisk: ScoreBand;
  cashPosition: { current: number; trend: "Improving" | "Declining" };
  compliance: ScoreBand;
  auditReadiness: ScoreBand;
  assetHealth: ScoreBand;
  majorAlerts: string[];
  opportunities: string[];
  recommendedActions: string[];
};

/** Pure — assembles the daily briefing entirely from real, already-
 * computed inputs. Major Alerts are the highest-confidence non-
 * opportunity signals; Opportunities are signals explicitly flagged as
 * such by the caller (e.g. a strong margin trend); Recommended Actions
 * are derived from whichever scores are weak/critical, each naming the
 * real score that triggered it. */
export function buildExecutiveBriefing(inputs: ExecutiveBriefingInputs): ExecutiveBriefing {
  const financialHealth = bandScore(inputs.financialHealthScore);
  const businessRisk = bandScore(inputs.businessRiskScore, "lowerIsBetter");
  const compliance = bandScore(inputs.complianceScorePercent);
  const auditReadiness = bandScore(inputs.auditReadinessScore);
  const assetHealth = bandScore(inputs.assetHealthScore);

  const sortedSignals = [...inputs.signals].sort((a, b) => b.confidence - a.confidence);
  const majorAlerts = sortedSignals.filter((s) => !s.isOpportunity).slice(0, 5).map((s) => `[${s.source}] ${s.label} (${Math.round(s.confidence * 100)}% confidence)`);
  const opportunities = sortedSignals.filter((s) => s.isOpportunity).slice(0, 5).map((s) => `[${s.source}] ${s.label}`);

  const recommendedActions: string[] = [];
  if (financialHealth.label === "Weak" || financialHealth.label === "Critical") recommendedActions.push(`Financial Health Score is ${financialHealth.score}% (${financialHealth.label}) — review the Reports workspace's Executive scores for the contributing factors.`);
  if (businessRisk.label === "Weak" || businessRisk.label === "Critical") recommendedActions.push(`Business Risk Score is ${inputs.businessRiskScore}% (${businessRisk.label}) — review open exceptions across Banking, VAT, and Audit.`);
  if (auditReadiness.label === "Weak" || auditReadiness.label === "Critical") recommendedActions.push(`Audit Readiness Score is ${auditReadiness.score}% (${auditReadiness.label}) — clear open Audit Findings before the next review.`);
  if (assetHealth.label === "Weak" || assetHealth.label === "Critical") recommendedActions.push(`Asset Health Score is ${assetHealth.score}% (${assetHealth.label}) — review open Asset Findings in the Fixed Assets workspace.`);
  if (!inputs.cashTrendImproving) recommendedActions.push(`Cash position is ${inputs.cashPosition} and the forecast trend is declining — review the Cashflow Forecast in Reports.`);

  return {
    financialHealth,
    businessRisk,
    cashPosition: { current: inputs.cashPosition, trend: inputs.cashTrendImproving ? "Improving" : "Declining" },
    compliance,
    auditReadiness,
    assetHealth,
    majorAlerts,
    opportunities,
    recommendedActions,
  };
}
