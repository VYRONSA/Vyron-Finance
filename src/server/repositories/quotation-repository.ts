/**
 * Repository layer for Quotations — no accounting impact, so this is
 * plain CRUD with no Posting Engine involvement (a quote is a commitment,
 * not a transaction).
 */

import { createClient } from "@/lib/supabase/server";
import { quotationFromRow, type QuotationRow } from "@/server/sales/mappers";
import type { Quotation, QuotationStatus } from "@/server/sales/types";

const QUOTATION_SELECT = "*, sales_quotation_lines(*)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function nextQuotationNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("sales_quotations").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `QT${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listQuotations(companyId: string): Promise<Quotation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_quotations")
    .select(QUOTATION_SELECT)
    .eq("company_id", companyId)
    .order("quotation_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<QuotationRow[]>();
  if (error) throw error;
  return data.map(quotationFromRow);
}

export async function getQuotation(companyId: string, quotationId: number): Promise<Quotation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_quotations")
    .select(QUOTATION_SELECT)
    .eq("company_id", companyId)
    .eq("id", quotationId)
    .maybeSingle<QuotationRow>();
  if (error) throw error;
  return data ? quotationFromRow(data) : null;
}

/** Finding #112 — `vatCode`/`vatAmount` optional: a caller that doesn't
 * supply them gets exactly today's behaviour (`lineTotal` unchanged at
 * quantity*unitPrice). */
export type NewQuotationLine = { description: string; quantity: number; unitPrice: number; vatCode?: string | null; vatAmount?: number };
export type NewQuotation = {
  quotationNumber?: string;
  customerId: number;
  quotationDate: string;
  expiryDate?: string | null;
  notes?: string;
  lines: NewQuotationLine[];
};

function toQuotationLineRow(quotationId: number, line: NewQuotationLine, index: number) {
  const vatAmount = line.vatAmount ?? 0;
  return {
    quotation_id: quotationId,
    line_order: index,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    line_total: Math.round((line.quantity * line.unitPrice + vatAmount) * 100) / 100,
    vat_code: line.vatCode ?? null,
    vat_amount: vatAmount,
  };
}

export async function createQuotation(companyId: string, input: NewQuotation): Promise<Quotation> {
  const supabase = await createClient();
  const quotationNumber = input.quotationNumber ?? (await nextQuotationNumber(companyId));

  const { data: quotationRow, error: quotationError } = await supabase
    .from("sales_quotations")
    .insert({
      company_id: companyId,
      customer_id: input.customerId,
      quotation_number: quotationNumber,
      quotation_date: input.quotationDate,
      expiry_date: input.expiryDate ?? null,
      notes: input.notes ?? "",
    })
    .select("*")
    .single<QuotationRow>();
  if (quotationError) throw quotationError;

  const { data: lineRows, error: linesError } = await supabase
    .from("sales_quotation_lines")
    .insert(input.lines.map((line, index) => toQuotationLineRow(quotationRow.id, line, index)))
    .select("*");
  if (linesError) throw linesError;

  return quotationFromRow({ ...quotationRow, sales_quotation_lines: lineRows });
}

/** Finding #055 — mirrors `sales-order-repository.ts::replaceOrderLines`
 * exactly. Only ever called for a Draft quotation (enforced by the
 * service layer). */
export async function replaceQuotationLines(companyId: string, quotationId: number, lines: NewQuotationLine[]): Promise<Quotation> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase.from("sales_quotation_lines").delete().eq("quotation_id", quotationId);
  if (deleteError) throw deleteError;

  const { error: linesError } = await supabase.from("sales_quotation_lines").insert(lines.map((line, index) => toQuotationLineRow(quotationId, line, index)));
  if (linesError) throw linesError;

  const quotation = await getQuotation(companyId, quotationId);
  if (!quotation) throw new Error(`No quotation with id ${quotationId}`);
  return quotation;
}

export async function setQuotationStatus(companyId: string, quotationId: number, status: QuotationStatus): Promise<Quotation> {
  const supabase = await createClient();
  const { error } = await supabase.from("sales_quotations").update({ status }).eq("company_id", companyId).eq("id", quotationId);
  if (error) throw error;
  const quotation = await getQuotation(companyId, quotationId);
  if (!quotation) throw new Error(`No quotation with id ${quotationId}`);
  return quotation;
}
