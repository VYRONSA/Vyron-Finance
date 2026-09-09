/**
 * Repository layer for VAT Payments — real settlement records against
 * one specific `vat_returns` row, clearing the VAT Control (2300)
 * liability the settlement journal posted on Approve. See
 * `vat-payment-service.ts`.
 */

import { createClient } from "@/lib/supabase/server";
import { vatPaymentFromRow, type VatPaymentRow } from "@/server/vat/mappers";
import type { VatPayment } from "@/server/vat/types";

export async function listVatPaymentsForReturn(companyId: string, vatReturnId: number): Promise<VatPayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_payments")
    .select("*")
    .eq("company_id", companyId)
    .eq("vat_return_id", vatReturnId)
    .order("payment_date", { ascending: false })
    .returns<VatPaymentRow[]>();
  if (error) throw error;
  return data.map(vatPaymentFromRow);
}

export type NewVatPayment = {
  vatReturnId: number;
  bankAccountId?: number | null;
  paymentDate: string;
  amount: number;
  reference?: string;
  notes?: string;
  journalId?: number | null;
  createdBy?: string;
};

export async function createVatPayment(companyId: string, input: NewVatPayment): Promise<VatPayment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vat_payments")
    .insert({
      company_id: companyId,
      vat_return_id: input.vatReturnId,
      bank_account_id: input.bankAccountId ?? null,
      payment_date: input.paymentDate,
      amount: input.amount,
      reference: input.reference ?? "",
      notes: input.notes ?? "",
      journal_id: input.journalId ?? null,
      created_by: input.createdBy ?? "System",
    })
    .select("*")
    .single<VatPaymentRow>();
  if (error) throw error;
  return vatPaymentFromRow(data);
}
