/**
 * Repository layer for VAT Adjustments — real, posts through the Posting
 * Engine via 'VAT Adjustment Increase'/'VAT Adjustment Decrease' posting
 * rules (see `0015_vat_intelligence_platform.sql`).
 */

import { createClient } from "@/lib/supabase/server";
import { vatAdjustmentFromRow, type VatAdjustmentRow } from "@/server/vat/mappers";
import type { VatAdjustment, VatAdjustmentDirection, VatAdjustmentTarget } from "@/server/vat/types";

export async function listVatAdjustments(companyId: string): Promise<VatAdjustment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_adjustments")
    .select("*")
    .eq("company_id", companyId)
    .order("adjustment_date", { ascending: false })
    .returns<VatAdjustmentRow[]>();
  if (error) throw error;
  return data.map(vatAdjustmentFromRow);
}

export async function getVatAdjustment(companyId: string, adjustmentId: number): Promise<VatAdjustment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_adjustments")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", adjustmentId)
    .maybeSingle<VatAdjustmentRow>();
  if (error) throw error;
  return data ? vatAdjustmentFromRow(data) : null;
}

export type NewVatAdjustment = {
  vatReturnId?: number | null;
  vatTreatmentId?: number | null;
  direction: VatAdjustmentDirection;
  targetAccount: VatAdjustmentTarget;
  amount: number;
  reason: string;
  adjustmentDate: string;
  createdBy?: string;
};

export async function createVatAdjustment(companyId: string, input: NewVatAdjustment): Promise<VatAdjustment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_adjustments")
    .insert({
      company_id: companyId,
      vat_return_id: input.vatReturnId ?? null,
      vat_treatment_id: input.vatTreatmentId ?? null,
      direction: input.direction,
      target_account: input.targetAccount,
      amount: input.amount,
      reason: input.reason,
      adjustment_date: input.adjustmentDate,
      created_by: input.createdBy ?? "System",
    })
    .select("*")
    .single<VatAdjustmentRow>();
  if (error) throw error;
  return vatAdjustmentFromRow(data);
}

export async function approveVatAdjustment(companyId: string, adjustmentId: number, journalId: number, approvedBy: string): Promise<VatAdjustment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_adjustments")
    .update({ status: "Approved", journal_id: journalId, approved_by: approvedBy, approved_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", adjustmentId)
    .select("*")
    .single<VatAdjustmentRow>();
  if (error) throw error;
  return vatAdjustmentFromRow(data);
}
