/**
 * Repository layer for Supplier Payments — the other Purchasing document
 * type that posts to the General Ledger (see
 * `supplier-payment-service.ts`). Allocations are a sub-ledger detail
 * only (which bill a payment settled) — they never generate their own
 * journal. Mirrors `customer-receipt-repository.ts` exactly.
 */

import { createClient } from "@/lib/supabase/server";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { supplierPaymentFromRow, type SupplierPaymentRow } from "@/server/purchasing/mappers";
import type { SupplierPayment } from "@/server/purchasing/types";

const PAYMENT_SELECT = "*, supplier_payment_allocations(*)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function nextPaymentNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("supplier_payments").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `PAY${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listSupplierPayments(companyId: string): Promise<SupplierPayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_payments")
    .select(PAYMENT_SELECT)
    .eq("company_id", companyId)
    .order("payment_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<SupplierPaymentRow[]>();
  if (error) throw error;
  return data.map(supplierPaymentFromRow);
}

export async function listSupplierPaymentsBySupplier(companyId: string, supplierId: number): Promise<SupplierPayment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_payments")
    .select(PAYMENT_SELECT)
    .eq("company_id", companyId)
    .eq("supplier_id", supplierId)
    .order("payment_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<SupplierPaymentRow[]>();
  if (error) throw error;
  return data.map(supplierPaymentFromRow);
}

export async function getSupplierPayment(companyId: string, paymentId: number): Promise<SupplierPayment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_payments")
    .select(PAYMENT_SELECT)
    .eq("company_id", companyId)
    .eq("id", paymentId)
    .maybeSingle<SupplierPaymentRow>();
  if (error) throw error;
  return data ? supplierPaymentFromRow(data) : null;
}

export type NewSupplierPayment = {
  paymentNumber?: string;
  supplierId: number;
  bankAccountId?: number | null;
  paymentDate: string;
  amount: number;
  reference?: string;
  notes?: string;
};

export async function createSupplierPayment(companyId: string, input: NewSupplierPayment): Promise<SupplierPayment> {
  const supabase = await createClient();
  const paymentNumber = input.paymentNumber ?? (await nextPaymentNumber(companyId));

  const { data, error } = await supabase
    .from("supplier_payments")
    .insert({
      company_id: companyId,
      supplier_id: input.supplierId,
      bank_account_id: input.bankAccountId ?? null,
      payment_number: paymentNumber,
      payment_date: input.paymentDate,
      amount: input.amount,
      reference: input.reference ?? "",
      notes: input.notes ?? "",
    })
    .select("*")
    .single<SupplierPaymentRow>();
  if (error) throw error;
  return supplierPaymentFromRow({ ...data, supplier_payment_allocations: [] });
}

async function setPaymentFields(companyId: string, paymentId: number, fields: Record<string, unknown>): Promise<SupplierPayment> {
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_payments").update(fields).eq("company_id", companyId).eq("id", paymentId);
  if (error) throw error;
  const payment = await getSupplierPayment(companyId, paymentId);
  if (!payment) throw new Error(`No supplier payment with id ${paymentId}`);
  return payment;
}

export async function approvePayment(companyId: string, paymentId: number, journalId: number): Promise<SupplierPayment> {
  const performedBy = await getPerformedByLabel();
  return setPaymentFields(companyId, paymentId, { status: "Approved", approved_by: performedBy, approved_at: new Date().toISOString(), journal_id: journalId });
}

export async function markPaymentPosted(companyId: string, paymentId: number): Promise<SupplierPayment> {
  return setPaymentFields(companyId, paymentId, { status: "Posted", posted_at: new Date().toISOString() });
}

export async function cancelPayment(companyId: string, paymentId: number): Promise<SupplierPayment> {
  return setPaymentFields(companyId, paymentId, { status: "Cancelled" });
}

export async function createPaymentAllocation(paymentId: number, billId: number, amountAllocated: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_payment_allocations").insert({ payment_id: paymentId, bill_id: billId, amount_allocated: amountAllocated });
  if (error) throw error;
}
