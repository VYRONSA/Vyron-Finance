/**
 * Repository layer for Disclosure Notes. See
 * supabase/migrations/0020_financial_statement_disclosure_engine.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { disclosureNoteFromRow, type DisclosureNoteRow } from "@/server/disclosures/mappers";
import type { DisclosureNote, DisclosureNoteType } from "@/server/disclosures/types";

export async function listDisclosureNotes(companyId: string, periodStart: string, periodEnd: string): Promise<DisclosureNote[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("disclosure_notes")
    .select("*")
    .eq("company_id", companyId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .order("note_type", { ascending: true })
    .returns<DisclosureNoteRow[]>();
  if (error) throw error;
  return data.map(disclosureNoteFromRow);
}

export type GeneratedDisclosureNote = { noteType: DisclosureNoteType; periodStart: string; periodEnd: string; title: string; generatedContent: Record<string, unknown>; requiresUserInput: boolean; generatedBy?: string };

/** Regenerating a note (re-running the Disclosure Engine against fresher
 * live data) must never silently discard a preparer's own commentary —
 * `user_notes` is preserved across the upsert, never overwritten by the
 * generated content. */
export async function upsertGeneratedDisclosureNote(companyId: string, input: GeneratedDisclosureNote): Promise<DisclosureNote> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("disclosure_notes")
    .select("user_notes")
    .eq("company_id", companyId)
    .eq("period_start", input.periodStart)
    .eq("period_end", input.periodEnd)
    .eq("note_type", input.noteType)
    .maybeSingle<{ user_notes: string }>();

  const { data, error } = await supabase
    .from("disclosure_notes")
    .upsert(
      {
        company_id: companyId,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        note_type: input.noteType,
        title: input.title,
        generated_content: input.generatedContent,
        requires_user_input: input.requiresUserInput,
        user_notes: existing?.user_notes ?? "",
        generated_by: input.generatedBy ?? "System",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,period_start,period_end,note_type" },
    )
    .select("*")
    .single<DisclosureNoteRow>();
  if (error) throw error;
  return disclosureNoteFromRow(data);
}

export async function updateDisclosureNoteUserNotes(companyId: string, noteId: number, userNotes: string): Promise<DisclosureNote> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("disclosure_notes")
    .update({ user_notes: userNotes, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", noteId)
    .select("*")
    .single<DisclosureNoteRow>();
  if (error) throw error;
  return disclosureNoteFromRow(data);
}
