/** Repository for `payments`/`refunds`/`billing_credits` (migration `0048`). */

import { createClient } from "@/lib/supabase/server";
import { paymentFromRow, refundFromRow, billingCreditFromRow, type PaymentRow, type RefundRow, type BillingCreditRow } from "../mappers";
import type { Payment, Refund, BillingCredit, PaymentStatus } from "../types";

export async function listPaymentsForBillingAccount(billingAccountId: string): Promise<Payment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("payments").select("*").eq("billing_account_id", billingAccountId).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as PaymentRow[];
  return rows.map(paymentFromRow);
}

export type NewPayment = {
  billingAccountId: string;
  invoiceId: string | null;
  status: PaymentStatus;
  amount: number;
  currencyCode: string;
  failureReason?: string | null;
  provider: Payment["provider"];
  providerPaymentId?: string | null;
};

export async function createPayment(input: NewPayment): Promise<Payment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .insert({
      billing_account_id: input.billingAccountId,
      invoice_id: input.invoiceId,
      status: input.status,
      amount: input.amount,
      currency_code: input.currencyCode,
      failure_reason: input.failureReason ?? null,
      provider: input.provider,
      provider_payment_id: input.providerPaymentId ?? null,
    })
    .select("*")
    .single<PaymentRow>();
  if (error) throw error;
  return paymentFromRow(data);
}

export async function createRefund(input: { paymentId: string; amount: number; reason: string; performedBy: string; provider: Refund["provider"]; providerRefundId?: string | null }): Promise<Refund> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("refunds")
    .insert({
      payment_id: input.paymentId, amount: input.amount, reason: input.reason, performed_by: input.performedBy,
      provider: input.provider, provider_refund_id: input.providerRefundId ?? null, status: "succeeded",
    })
    .select("*")
    .single<RefundRow>();
  if (error) throw error;
  return refundFromRow(data);
}

export async function createBillingCredit(input: { billingAccountId: string; amount: number; currencyCode: string; reason: string; performedBy: string }): Promise<BillingCredit> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_credits")
    .insert({ billing_account_id: input.billingAccountId, amount: input.amount, currency_code: input.currencyCode, reason: input.reason, performed_by: input.performedBy })
    .select("*")
    .single<BillingCreditRow>();
  if (error) throw error;
  return billingCreditFromRow(data);
}

export async function listCreditsForBillingAccount(billingAccountId: string): Promise<BillingCredit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_credits").select("*").eq("billing_account_id", billingAccountId).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as BillingCreditRow[];
  return rows.map(billingCreditFromRow);
}
