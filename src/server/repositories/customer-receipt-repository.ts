/**
 * Repository layer for Customer Receipts — the other Sales document type
 * that posts to the General Ledger (see `customer-receipt-service.ts`).
 * Allocations are a sub-ledger detail only (which invoice a receipt paid
 * off) — they never generate their own journal.
 */

import { createClient } from "@/lib/supabase/server";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { customerReceiptFromRow, type CustomerReceiptRow } from "@/server/sales/mappers";
import type { CustomerReceipt } from "@/server/sales/types";

const RECEIPT_SELECT = "*, customer_receipt_allocations(*)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function nextReceiptNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("customer_receipts").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `RCPT${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listCustomerReceipts(companyId: string): Promise<CustomerReceipt[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_receipts")
    .select(RECEIPT_SELECT)
    .eq("company_id", companyId)
    .order("receipt_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<CustomerReceiptRow[]>();
  if (error) throw error;
  return data.map(customerReceiptFromRow);
}

export async function listCustomerReceiptsByCustomer(companyId: string, customerId: number): Promise<CustomerReceipt[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_receipts")
    .select(RECEIPT_SELECT)
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .order("receipt_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<CustomerReceiptRow[]>();
  if (error) throw error;
  return data.map(customerReceiptFromRow);
}

export async function getCustomerReceipt(companyId: string, receiptId: number): Promise<CustomerReceipt | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_receipts")
    .select(RECEIPT_SELECT)
    .eq("company_id", companyId)
    .eq("id", receiptId)
    .maybeSingle<CustomerReceiptRow>();
  if (error) throw error;
  return data ? customerReceiptFromRow(data) : null;
}

export type NewCustomerReceipt = {
  receiptNumber?: string;
  customerId: number;
  bankAccountId?: number | null;
  receiptDate: string;
  amount: number;
  reference?: string;
  notes?: string;
};

export async function createCustomerReceipt(companyId: string, input: NewCustomerReceipt): Promise<CustomerReceipt> {
  const supabase = await createClient();
  const receiptNumber = input.receiptNumber ?? (await nextReceiptNumber(companyId));

  const { data, error } = await supabase
    .from("customer_receipts")
    .insert({
      company_id: companyId,
      customer_id: input.customerId,
      bank_account_id: input.bankAccountId ?? null,
      receipt_number: receiptNumber,
      receipt_date: input.receiptDate,
      amount: input.amount,
      reference: input.reference ?? "",
      notes: input.notes ?? "",
    })
    .select("*")
    .single<CustomerReceiptRow>();
  if (error) throw error;
  return customerReceiptFromRow({ ...data, customer_receipt_allocations: [] });
}

async function setReceiptFields(companyId: string, receiptId: number, fields: Record<string, unknown>): Promise<CustomerReceipt> {
  const supabase = await createClient();
  const { error } = await supabase.from("customer_receipts").update(fields).eq("company_id", companyId).eq("id", receiptId);
  if (error) throw error;
  const receipt = await getCustomerReceipt(companyId, receiptId);
  if (!receipt) throw new Error(`No customer receipt with id ${receiptId}`);
  return receipt;
}

export async function approveReceipt(companyId: string, receiptId: number, journalId: number): Promise<CustomerReceipt> {
  const performedBy = await getPerformedByLabel();
  return setReceiptFields(companyId, receiptId, { status: "Approved", approved_by: performedBy, approved_at: new Date().toISOString(), journal_id: journalId });
}

export async function markReceiptPosted(companyId: string, receiptId: number): Promise<CustomerReceipt> {
  return setReceiptFields(companyId, receiptId, { status: "Posted", posted_at: new Date().toISOString() });
}

export async function cancelReceipt(companyId: string, receiptId: number): Promise<CustomerReceipt> {
  return setReceiptFields(companyId, receiptId, { status: "Cancelled" });
}

export async function createReceiptAllocation(receiptId: number, invoiceId: number, amountAllocated: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("customer_receipt_allocations").insert({ receipt_id: receiptId, invoice_id: invoiceId, amount_allocated: amountAllocated });
  if (error) throw error;
}
