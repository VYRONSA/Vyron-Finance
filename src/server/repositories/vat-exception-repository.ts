/**
 * Repository layer for the VAT Exception Centre — same shape as Banking
 * Exceptions (Module 6), a separate table since the exception-type
 * vocabulary and linked document types are genuinely different.
 */

import { createClient } from "@/lib/supabase/server";
import { vatExceptionFromRow, type VatExceptionRow } from "@/server/vat/mappers";
import type { VatException, VatExceptionStatus, VatExceptionType } from "@/server/vat/types";

const UNIQUE_VIOLATION = "23505";

export async function listVatExceptions(companyId: string, status?: VatExceptionStatus): Promise<VatException[]> {
  const supabase = await createClient();
  let query = supabase.from("vat_exceptions").select("*").eq("company_id", companyId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(10_000).returns<VatExceptionRow[]>();
  if (error) throw error;
  return data.map(vatExceptionFromRow);
}

export async function getVatException(companyId: string, exceptionId: number): Promise<VatException | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_exceptions")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", exceptionId)
    .maybeSingle<VatExceptionRow>();
  if (error) throw error;
  return data ? vatExceptionFromRow(data) : null;
}

export type NewVatException = {
  exceptionType: VatExceptionType;
  documentType: string;
  documentId: number;
  reason: string;
  evidence: string;
  recommendedAction: string;
};

/** Idempotent per (document, type, Open) — mirrors
 * `banking-exception-repository.ts::raiseExceptionIdempotent`. */
export async function raiseVatExceptionIdempotent(companyId: string, input: NewVatException): Promise<VatException> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_exceptions")
    .insert({
      company_id: companyId,
      exception_type: input.exceptionType,
      document_type: input.documentType,
      document_id: input.documentId,
      reason: input.reason,
      evidence: input.evidence,
      recommended_action: input.recommendedAction,
      status: "Open",
    })
    .select("*")
    .single<VatExceptionRow>();

  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      const { data: existing, error: selectError } = await supabase
        .from("vat_exceptions")
        .select("*")
        .eq("document_type", input.documentType)
        .eq("document_id", input.documentId)
        .eq("exception_type", input.exceptionType)
        .eq("status", "Open")
        .single<VatExceptionRow>();
      if (selectError) throw selectError;
      return vatExceptionFromRow(existing);
    }
    throw error;
  }
  return vatExceptionFromRow(data);
}

export async function resolveVatException(companyId: string, exceptionId: number, status: "Resolved" | "Dismissed", resolvedBy: string, note: string): Promise<VatException> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_exceptions")
    .update({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq("company_id", companyId)
    .eq("id", exceptionId)
    .select("*")
    .single<VatExceptionRow>();
  if (error) throw error;
  return vatExceptionFromRow(data);
}
