/** Repository for `invoices`/`invoice_lines` (migration `0048`). */

import { createClient } from "@/lib/supabase/server";
import { invoiceFromRow, invoiceLineFromRow, type InvoiceRow, type InvoiceLineRow } from "../mappers";
import type { Invoice, InvoiceLine, InvoiceStatus } from "../types";

export async function listInvoicesForBillingAccount(billingAccountId: string): Promise<Invoice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").select("*").eq("billing_account_id", billingAccountId).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as InvoiceRow[];
  return rows.map(invoiceFromRow);
}

export async function getInvoice(invoiceId: string): Promise<Invoice | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle<InvoiceRow>();
  if (error) throw error;
  return data ? invoiceFromRow(data) : null;
}

export async function listInvoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoice_lines").select("*").eq("invoice_id", invoiceId).order("line_order");
  if (error) throw error;
  const rows = (data ?? []) as InvoiceLineRow[];
  return rows.map(invoiceLineFromRow);
}

export type NewInvoice = {
  billingAccountId: string;
  subscriptionId: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  currencyCode: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  issuedAt?: string | null;
  dueAt?: string | null;
  provider: Invoice["provider"];
  providerInvoiceId?: string | null;
  lines: { description: string; quantity: number; unitAmount: number; amount: number; lineOrder: number }[];
};

export async function createInvoice(input: NewInvoice): Promise<Invoice> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      billing_account_id: input.billingAccountId,
      subscription_id: input.subscriptionId,
      invoice_number: input.invoiceNumber,
      status: input.status,
      currency_code: input.currencyCode,
      subtotal: input.subtotal,
      tax_amount: input.taxAmount,
      total: input.total,
      issued_at: input.issuedAt ?? null,
      due_at: input.dueAt ?? null,
      provider: input.provider,
      provider_invoice_id: input.providerInvoiceId ?? null,
    })
    .select("*")
    .single<InvoiceRow>();
  if (error) throw error;

  if (input.lines.length > 0) {
    const { error: linesError } = await supabase.from("invoice_lines").insert(
      input.lines.map((l) => ({ invoice_id: data.id, description: l.description, quantity: l.quantity, unit_amount: l.unitAmount, amount: l.amount, line_order: l.lineOrder })),
    );
    if (linesError) throw linesError;
  }

  return invoiceFromRow(data);
}

export async function markInvoicePaid(invoiceId: string, amountPaid: number, paidAtIso: string): Promise<Invoice> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "paid", amount_paid: amountPaid, paid_at: paidAtIso })
    .eq("id", invoiceId)
    .select("*")
    .single<InvoiceRow>();
  if (error) throw error;
  return invoiceFromRow(data);
}
