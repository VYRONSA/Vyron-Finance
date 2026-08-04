/**
 * Row <-> domain type mappers for the AI Executive Copilot & Financial
 * Intelligence Platform (Module 12). See
 * supabase/migrations/0019_ai_executive_copilot_platform.sql.
 */

import type { CopilotBriefing, CopilotNarrative, CopilotScenario } from "./types";

export type CopilotScenarioRow = {
  id: number;
  company_id: string;
  name: string;
  scenario_type: string;
  parameters: unknown;
  results: unknown;
  created_by: string;
  created_at: string;
};

export function copilotScenarioFromRow(row: CopilotScenarioRow): CopilotScenario {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    scenarioType: row.scenario_type as CopilotScenario["scenarioType"],
    parameters: (row.parameters as Record<string, unknown>) ?? {},
    results: (row.results as Record<string, unknown>) ?? {},
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export type CopilotNarrativeRow = {
  id: number;
  company_id: string;
  narrative_type: string;
  period_start: string;
  period_end: string;
  title: string;
  content: unknown;
  generated_at: string;
  generated_by: string;
};

export function copilotNarrativeFromRow(row: CopilotNarrativeRow): CopilotNarrative {
  return {
    id: row.id,
    companyId: row.company_id,
    narrativeType: row.narrative_type as CopilotNarrative["narrativeType"],
    periodStart: row.period_start,
    periodEnd: row.period_end,
    title: row.title,
    content: (row.content as Record<string, unknown>) ?? {},
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  };
}

export type CopilotBriefingRow = {
  id: number;
  company_id: string;
  briefing_date: string;
  content: unknown;
  generated_at: string;
  generated_by: string;
};

export function copilotBriefingFromRow(row: CopilotBriefingRow): CopilotBriefing {
  return {
    id: row.id,
    companyId: row.company_id,
    briefingDate: row.briefing_date,
    content: (row.content as Record<string, unknown>) ?? {},
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
  };
}
