/**
 * Repository layer for saved What-If Scenarios. See
 * supabase/migrations/0019_ai_executive_copilot_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { copilotScenarioFromRow, type CopilotScenarioRow } from "@/server/copilot/mappers";
import type { CopilotScenario, ScenarioType } from "@/server/copilot/types";

export async function listCopilotScenarios(companyId: string): Promise<CopilotScenario[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("copilot_scenarios").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).returns<CopilotScenarioRow[]>();
  if (error) throw error;
  return data.map(copilotScenarioFromRow);
}

export type NewCopilotScenario = { name: string; scenarioType: ScenarioType; parameters: Record<string, unknown>; results: Record<string, unknown>; createdBy?: string };

export async function createCopilotScenario(companyId: string, input: NewCopilotScenario): Promise<CopilotScenario> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("copilot_scenarios")
    .insert({ company_id: companyId, name: input.name, scenario_type: input.scenarioType, parameters: input.parameters, results: input.results, created_by: input.createdBy ?? "System" })
    .select("*")
    .single<CopilotScenarioRow>();
  if (error) throw error;
  return copilotScenarioFromRow(data);
}

export async function deleteCopilotScenario(companyId: string, scenarioId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("copilot_scenarios").delete().eq("company_id", companyId).eq("id", scenarioId);
  if (error) throw error;
}
