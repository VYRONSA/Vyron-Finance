/**
 * Repository layer for daily Executive Briefings. See
 * supabase/migrations/0019_ai_executive_copilot_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { copilotBriefingFromRow, type CopilotBriefingRow } from "@/server/copilot/mappers";
import type { CopilotBriefing } from "@/server/copilot/types";

export async function listCopilotBriefings(companyId: string, limit = 30): Promise<CopilotBriefing[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("copilot_briefings").select("*").eq("company_id", companyId).order("briefing_date", { ascending: false }).limit(limit).returns<CopilotBriefingRow[]>();
  if (error) throw error;
  return data.map(copilotBriefingFromRow);
}

export async function getCopilotBriefingForDate(companyId: string, briefingDate: string): Promise<CopilotBriefing | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("copilot_briefings").select("*").eq("company_id", companyId).eq("briefing_date", briefingDate).maybeSingle<CopilotBriefingRow>();
  if (error) throw error;
  return data ? copilotBriefingFromRow(data) : null;
}

export async function upsertCopilotBriefing(companyId: string, briefingDate: string, content: Record<string, unknown>, generatedBy: string): Promise<CopilotBriefing> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("copilot_briefings")
    .upsert({ company_id: companyId, briefing_date: briefingDate, content, generated_by: generatedBy, generated_at: new Date().toISOString() }, { onConflict: "company_id,briefing_date" })
    .select("*")
    .single<CopilotBriefingRow>();
  if (error) throw error;
  return copilotBriefingFromRow(data);
}
