/**
 * Bulk Unallocate Bank Transactions (migration 0119). Both calls run under
 * the signed-in user's own session: the database checks `Banking:Edit`
 * itself and stamps the audit actor from that session, so neither can be
 * borrowed or forged from here. This file only speaks Supabase; turning a
 * database refusal into an accountant-facing message is the service's job.
 */

import { createClient } from "@/lib/supabase/server";
import type {
  UnallocationCandidate,
  UnallocationRequest,
  UnallocationResult,
  UnpostingCandidate,
  UnpostingRequest,
  UnpostingResult,
} from "@/server/banking/bulk-unallocation";

type PreviewRow = {
  id: number;
  transaction_date: string;
  description: string;
  reference: string;
  debit: number | string;
  credit: number | string;
  bank_account_id: number | null;
  bank_account_name: string | null;
  allocation_status: string;
  allocation_method: string | null;
  gl_account_code: string | null;
  gl_account_name: string | null;
  exclusion_reason: string | null;
};

export function candidateFromRow(row: PreviewRow): UnallocationCandidate {
  return {
    id: Number(row.id),
    transactionDate: row.transaction_date,
    description: row.description ?? "",
    reference: row.reference ?? "",
    amount: Math.round((Number(row.credit) - Number(row.debit)) * 100) / 100,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_account_name,
    allocationStatus: row.allocation_status,
    allocationMethod: row.allocation_method,
    glAccountCode: row.gl_account_code,
    glAccountName: row.gl_account_name,
    exclusionReason: row.exclusion_reason,
  };
}

export async function previewBankUnallocation(
  companyId: string,
  dateFrom: string,
  dateTo: string,
  bankAccountId: number | null,
  limit: number,
): Promise<UnallocationCandidate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_preview_bank_unallocation", {
    p_company_id: companyId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_bank_account_id: bankAccountId,
    p_limit: limit,
  });
  if (error) throw error;
  return ((data ?? []) as PreviewRow[]).map(candidateFromRow);
}

export async function executeBankUnallocation(companyId: string, request: UnallocationRequest): Promise<UnallocationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_bulk_unallocate_bank_transactions", {
    p_company_id: companyId,
    p_request_key: request.requestKey,
    p_date_from: request.dateFrom,
    p_date_to: request.dateTo,
    p_bank_account_id: request.bankAccountId,
    p_items: request.items,
  });
  if (error) throw error;
  return data as UnallocationResult;
}

// ---------------------------------------------------------------------
// Posted transactions (migration 0120). Same session rules: the database
// checks Banking:Edit and GeneralLedger:Reverse and stamps the actor.
// ---------------------------------------------------------------------

type UnpostingPreviewRow = {
  id: number;
  transaction_date: string;
  description: string;
  reference: string;
  debit: number | string;
  credit: number | string;
  bank_account_id: number | null;
  bank_account_name: string | null;
  allocation_status: string;
  allocation_type: string | null;
  gl_account_code: string | null;
  gl_account_name: string | null;
  customer_id: number | null;
  customer_code: string | null;
  customer_name: string | null;
  supplier_id: number | null;
  supplier_code: string | null;
  supplier_name: string | null;
  journal_id: number | null;
  journal_number: string | null;
  journal_date: string | null;
  journal_source_type: string | null;
  journal_transaction_count: number | null;
  exclusion_reason: string | null;
};

export function unpostingCandidateFromRow(row: UnpostingPreviewRow): UnpostingCandidate {
  return {
    id: Number(row.id),
    transactionDate: row.transaction_date,
    description: row.description ?? "",
    reference: row.reference ?? "",
    amount: Math.round((Number(row.credit) - Number(row.debit)) * 100) / 100,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_account_name,
    allocationStatus: row.allocation_status,
    allocationType: row.allocation_type,
    glAccountCode: row.gl_account_code,
    glAccountName: row.gl_account_name,
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    customerCode: row.customer_code,
    customerName: row.customer_name,
    supplierId: row.supplier_id === null ? null : Number(row.supplier_id),
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    journalId: row.journal_id === null ? null : Number(row.journal_id),
    journalNumber: row.journal_number,
    journalDate: row.journal_date,
    journalSourceType: row.journal_source_type,
    journalTransactionCount: Number(row.journal_transaction_count ?? 0),
    exclusionReason: row.exclusion_reason,
  };
}

export async function previewBankUnposting(
  companyId: string,
  dateFrom: string,
  dateTo: string,
  bankAccountId: number | null,
  limit: number,
): Promise<UnpostingCandidate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_preview_bank_unposting", {
    p_company_id: companyId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_bank_account_id: bankAccountId,
    p_limit: limit,
  });
  if (error) throw error;
  return ((data ?? []) as UnpostingPreviewRow[]).map(unpostingCandidateFromRow);
}

export async function executeBankUnposting(companyId: string, request: UnpostingRequest): Promise<UnpostingResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_bulk_unpost_bank_transactions", {
    p_company_id: companyId,
    p_request_key: request.requestKey,
    p_date_from: request.dateFrom,
    p_date_to: request.dateTo,
    p_bank_account_id: request.bankAccountId,
    p_items: request.items,
  });
  if (error) throw error;
  return data as UnpostingResult;
}
