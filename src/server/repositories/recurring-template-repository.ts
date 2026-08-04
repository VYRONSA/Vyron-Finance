/**
 * Repository layer for Recurring Documents — the only layer allowed to
 * speak Supabase for `recurring_templates`/`generated_documents`.
 */

import { createClient } from "@/lib/supabase/server";
import {
  generatedDocumentFromRow,
  recurringTemplateFromRow,
  type GeneratedDocumentRow,
  type RecurringTemplateRow,
} from "@/server/automation/mappers";
import type { GeneratedDocument, RecurringDocumentType, RecurringTemplate } from "@/server/automation/types";
import type { RecurrenceFrequency } from "@/server/automation/recurrence";

export async function listRecurringTemplates(companyId: string): Promise<RecurringTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_templates")
    .select("*")
    .eq("company_id", companyId)
    .order("next_run_date")
    .returns<RecurringTemplateRow[]>();
  if (error) throw error;
  return data.map(recurringTemplateFromRow);
}

export async function getRecurringTemplate(companyId: string, templateId: number): Promise<RecurringTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_templates")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", templateId)
    .maybeSingle<RecurringTemplateRow>();
  if (error) throw error;
  return data ? recurringTemplateFromRow(data) : null;
}

/** Every active template whose `next_run_date` has arrived — the
 * Scheduler's own worklist for `task_type = 'RecurringTemplate'` tasks. */
export async function listDueRecurringTemplates(companyId: string, todayIso: string): Promise<RecurringTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_templates")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .lte("next_run_date", todayIso)
    .returns<RecurringTemplateRow[]>();
  if (error) throw error;
  return data.map(recurringTemplateFromRow);
}

export type NewRecurringTemplate = {
  documentType: RecurringDocumentType;
  name: string;
  frequency: RecurrenceFrequency;
  intervalCount?: number;
  startDate: string;
  endDate?: string | null;
  maxOccurrences?: number | null;
  skipWeekends?: boolean;
  skipPublicHolidays?: boolean;
  numberingPrefix?: string;
  documentPayload: Record<string, unknown>;
  workflowDefinitionId?: number | null;
  performedBy?: string;
};

export async function createRecurringTemplate(companyId: string, input: NewRecurringTemplate): Promise<RecurringTemplate> {
  const supabase = await createClient();
  const performedBy = input.performedBy ?? "System";
  const { data, error } = await supabase
    .from("recurring_templates")
    .insert({
      company_id: companyId,
      document_type: input.documentType,
      name: input.name,
      frequency: input.frequency,
      interval_count: input.intervalCount ?? 1,
      start_date: input.startDate,
      end_date: input.endDate ?? null,
      max_occurrences: input.maxOccurrences ?? null,
      skip_weekends: input.skipWeekends ?? false,
      skip_public_holidays: input.skipPublicHolidays ?? false,
      next_run_date: input.startDate,
      numbering_prefix: input.numberingPrefix ?? "",
      document_payload: input.documentPayload,
      workflow_definition_id: input.workflowDefinitionId ?? null,
      created_by: performedBy,
      updated_by: performedBy,
    })
    .select("*")
    .single<RecurringTemplateRow>();
  if (error) throw error;
  return recurringTemplateFromRow(data);
}

export type UpdatableRecurringTemplateFields = Partial<{
  name: string;
  is_active: boolean;
  end_date: string | null;
  max_occurrences: number | null;
  skip_weekends: boolean;
  skip_public_holidays: boolean;
}>;

export async function updateRecurringTemplate(companyId: string, templateId: number, fields: UpdatableRecurringTemplateFields, performedBy = "System"): Promise<RecurringTemplate> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_templates")
    .update({ ...fields, updated_by: performedBy, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", templateId)
    .select("*")
    .single<RecurringTemplateRow>();
  if (error) throw error;
  return recurringTemplateFromRow(data);
}

/** Advances `next_run_date`/`last_run_date`/`occurrences_generated`
 * after a real generation attempt — called once per run regardless of
 * whether generation succeeded, so a failing template doesn't loop on
 * the same date forever (its failure is recorded via `generated_documents`
 * / the automation task run instead). */
export async function advanceRecurringTemplate(companyId: string, templateId: number, ranOnDate: string, nextRunDate: string): Promise<RecurringTemplate> {
  const supabase = await createClient();
  const { data: current, error: fetchError } = await supabase
    .from("recurring_templates")
    .select("occurrences_generated")
    .eq("company_id", companyId)
    .eq("id", templateId)
    .single<{ occurrences_generated: number }>();
  if (fetchError) throw fetchError;

  const { data, error } = await supabase
    .from("recurring_templates")
    .update({ last_run_date: ranOnDate, next_run_date: nextRunDate, occurrences_generated: current.occurrences_generated + 1 })
    .eq("company_id", companyId)
    .eq("id", templateId)
    .select("*")
    .single<RecurringTemplateRow>();
  if (error) throw error;
  return recurringTemplateFromRow(data);
}

export async function recordGeneratedDocument(companyId: string, input: {
  recurringTemplateId: number;
  documentType: string;
  referenceType?: string;
  referenceId?: number | null;
  status: "Success" | "Failed";
  errorMessage?: string | null;
  summary?: string;
}): Promise<GeneratedDocument> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("generated_documents")
    .insert({
      company_id: companyId,
      recurring_template_id: input.recurringTemplateId,
      document_type: input.documentType,
      reference_type: input.referenceType ?? "",
      reference_id: input.referenceId ?? null,
      status: input.status,
      error_message: input.errorMessage ?? null,
      summary: input.summary ?? "",
    })
    .select("*")
    .single<GeneratedDocumentRow>();
  if (error) throw error;
  return generatedDocumentFromRow(data);
}

export async function listGeneratedDocuments(companyId: string, templateId?: number): Promise<GeneratedDocument[]> {
  const supabase = await createClient();
  let query = supabase.from("generated_documents").select("*").eq("company_id", companyId);
  if (templateId) query = query.eq("recurring_template_id", templateId);
  const { data, error } = await query.order("generated_at", { ascending: false }).returns<GeneratedDocumentRow[]>();
  if (error) throw error;
  return data.map(generatedDocumentFromRow);
}
