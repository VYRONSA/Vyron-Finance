/**
 * Repository layer for generated Financial Narratives. See
 * supabase/migrations/0019_ai_executive_copilot_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { copilotNarrativeFromRow, type CopilotNarrativeRow } from "@/server/copilot/mappers";
import type { CopilotNarrative, NarrativeType } from "@/server/copilot/types";

export async function listCopilotNarratives(companyId: string): Promise<CopilotNarrative[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("copilot_narratives").select("*").eq("company_id", companyId).order("generated_at", { ascending: false }).returns<CopilotNarrativeRow[]>();
  if (error) throw error;
  return data.map(copilotNarrativeFromRow);
}

export type NewCopilotNarrative = { narrativeType: NarrativeType; periodStart: string; periodEnd: string; title: string; content: Record<string, unknown>; generatedBy?: string };

export async function createCopilotNarrative(companyId: string, input: NewCopilotNarrative): Promise<CopilotNarrative> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("copilot_narratives")
    .insert({ company_id: companyId, narrative_type: input.narrativeType, period_start: input.periodStart, period_end: input.periodEnd, title: input.title, content: input.content, generated_by: input.generatedBy ?? "System" })
    .select("*")
    .single<CopilotNarrativeRow>();
  if (error) throw error;
  return copilotNarrativeFromRow(data);
}
