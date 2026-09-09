/**
 * Repository layer for VAT Returns — generated from live GL data
 * (VAT Input/Output account activity), never a second source of truth.
 */

import { createClient } from "@/lib/supabase/server";
import { vatReturnFromRow, type VatReturnRow } from "@/server/vat/mappers";
import type { VatReturn, VatReturnStatus, VatSubmissionMethod } from "@/server/vat/types";

// Finding #016 (RC-6) — the one query this repository had with no cap
// at all; the sibling Dashboard query that feeds off this list was
// already fixed for the identical defect class elsewhere.
const LIST_CAP = 10_000;

export async function listVatReturns(companyId: string): Promise<VatReturn[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_returns")
    .select("*")
    .eq("company_id", companyId)
    .order("period_start", { ascending: false })
    .limit(LIST_CAP)
    .returns<VatReturnRow[]>();
  if (error) throw error;
  return data.map(vatReturnFromRow);
}

export async function getVatReturn(companyId: string, vatReturnId: number): Promise<VatReturn | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_returns")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", vatReturnId)
    .maybeSingle<VatReturnRow>();
  if (error) throw error;
  return data ? vatReturnFromRow(data) : null;
}

export async function findVatReturnForPeriod(companyId: string, periodStart: string, periodEnd: string): Promise<VatReturn | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_returns")
    .select("*")
    .eq("company_id", companyId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .eq("is_amendment", false)
    .maybeSingle<VatReturnRow>();
  if (error) throw error;
  return data ? vatReturnFromRow(data) : null;
}

export type NewVatReturn = {
  periodStart: string;
  periodEnd: string;
  totalOutputVat: number;
  totalInputVat: number;
  netPayable: number;
  broughtForward?: number;
  isAmendment?: boolean;
  amendedReturnId?: number | null;
  generatedBy?: string;
};

export async function createVatReturn(companyId: string, input: NewVatReturn): Promise<VatReturn> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_returns")
    .insert({
      company_id: companyId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      total_output_vat: input.totalOutputVat,
      total_input_vat: input.totalInputVat,
      net_payable: input.netPayable,
      brought_forward: input.broughtForward ?? 0,
      is_amendment: input.isAmendment ?? false,
      amended_return_id: input.amendedReturnId ?? null,
      generated_by: input.generatedBy ?? "System",
    })
    .select("*")
    .single<VatReturnRow>();
  if (error) throw error;
  return vatReturnFromRow(data);
}

/** Finding #202 — the most recent non-amendment return whose period ends
 * before the given period starts, used to derive the next return's
 * `broughtForward` at generation time. */
export async function findPriorVatReturn(companyId: string, beforePeriodStart: string): Promise<VatReturn | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_returns")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_amendment", false)
    .lt("period_end", beforePeriodStart)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle<VatReturnRow>();
  if (error) throw error;
  return data ? vatReturnFromRow(data) : null;
}

/** Recalculation replaces a Draft return's own figures in place (never
 * mutates a Review/Approved/Submitted one — see `vat-return-service.ts`
 * for that guard). */
export async function updateVatReturnFigures(companyId: string, vatReturnId: number, fields: { totalOutputVat: number; totalInputVat: number; netPayable: number }): Promise<VatReturn> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_returns")
    .update({ total_output_vat: fields.totalOutputVat, total_input_vat: fields.totalInputVat, net_payable: fields.netPayable, generated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", vatReturnId)
    .select("*")
    .single<VatReturnRow>();
  if (error) throw error;
  return vatReturnFromRow(data);
}

export async function setVatReturnStatus(
  companyId: string,
  vatReturnId: number,
  status: VatReturnStatus,
  fields: { approvedBy?: string; settlementJournalId?: number; submittedAt?: string; sarsReference?: string; submissionMethod?: VatSubmissionMethod } = {},
): Promise<VatReturn> {
  const supabase = await createClient();
  const update: Record<string, unknown> = { status };
  if (fields.approvedBy !== undefined) {
    update.approved_by = fields.approvedBy;
    update.approved_at = new Date().toISOString();
  }
  if (fields.settlementJournalId !== undefined) update.settlement_journal_id = fields.settlementJournalId;
  if (fields.submittedAt !== undefined) update.submitted_at = fields.submittedAt;
  if (fields.sarsReference !== undefined) update.sars_reference = fields.sarsReference;
  if (fields.submissionMethod !== undefined) update.submission_method = fields.submissionMethod;

  const { data, error } = await supabase
    .from("vat_returns")
    .update(update)
    .eq("company_id", companyId)
    .eq("id", vatReturnId)
    .select("*")
    .single<VatReturnRow>();
  if (error) throw error;
  return vatReturnFromRow(data);
}

export async function updateVatReturnNotes(companyId: string, vatReturnId: number, notes: string): Promise<VatReturn> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_returns")
    .update({ notes })
    .eq("company_id", companyId)
    .eq("id", vatReturnId)
    .select("*")
    .single<VatReturnRow>();
  if (error) throw error;
  return vatReturnFromRow(data);
}
