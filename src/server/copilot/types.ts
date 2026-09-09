/**
 * Domain types for the AI Executive Copilot & Financial Intelligence
 * Platform (Module 12). See
 * supabase/migrations/0019_ai_executive_copilot_platform.sql.
 */

export type ScenarioType = "SalesIncrease" | "ReceiptDelay" | "SupplierPriceIncrease" | "AssetReplacement" | "OpexReduction" | "Hiring";
export const SCENARIO_TYPES: ScenarioType[] = ["SalesIncrease", "ReceiptDelay", "SupplierPriceIncrease", "AssetReplacement", "OpexReduction", "Hiring"];

export type CopilotScenario = {
  id: number;
  companyId: string;
  name: string;
  scenarioType: ScenarioType;
  parameters: Record<string, unknown>;
  results: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
};

export type NarrativeType = "MonthEnd" | "QuarterEnd" | "YearEnd" | "BoardPack" | "ManagementReport" | "CashFlowCommentary" | "BudgetVarianceExplanation" | "ProfitabilityCommentary";
export const NARRATIVE_TYPES: NarrativeType[] = ["MonthEnd", "QuarterEnd", "YearEnd", "BoardPack", "ManagementReport", "CashFlowCommentary", "BudgetVarianceExplanation", "ProfitabilityCommentary"];

export type CopilotNarrative = {
  id: number;
  companyId: string;
  narrativeType: NarrativeType;
  periodStart: string;
  periodEnd: string;
  title: string;
  content: Record<string, unknown>;
  generatedAt: string;
  generatedBy: string;
};

export type CopilotBriefing = {
  id: number;
  companyId: string;
  briefingDate: string;
  content: Record<string, unknown>;
  generatedAt: string;
  generatedBy: string;
};
