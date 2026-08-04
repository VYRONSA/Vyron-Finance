/**
 * Repository layer for the Banking Exceptions workspace — the dedicated
 * queue the Product Review Board's own brief asked for ("Unknown
 * transactions should become the exception — not the normal workflow").
 */

import { createClient } from "@/lib/supabase/server";
import { bankingExceptionFromRow, type BankingExceptionRow } from "@/server/banking-rules/mappers";
import type { BankingException, ExceptionStatus, ExceptionType } from "@/server/banking-rules/types";

export async function listBankingExceptions(companyId: string, status?: ExceptionStatus): Promise<BankingException[]> {
  const supabase = await createClient();
  let query = supabase.from("banking_exceptions").select("*").eq("company_id", companyId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false }).returns<BankingExceptionRow[]>();
  if (error) throw error;
  return data.map(bankingExceptionFromRow);
}

export async function getBankingException(companyId: string, exceptionId: number): Promise<BankingException | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banking_exceptions")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", exceptionId)
    .maybeSingle<BankingExceptionRow>();
  if (error) throw error;
  return data ? bankingExceptionFromRow(data) : null;
}

export type NewBankingException = {
  bankTransactionId: number;
  exceptionType: ExceptionType;
  reason: string;
  evidence: string;
  recommendedAction: string;
};

const UNIQUE_VIOLATION = "23505";

/** Idempotent per (transaction, type, Open) — re-running the rule engine
 * over an already-flagged transaction never creates a duplicate open
 * exception, mirroring `import-repository.ts::ingestBankTransactionIdempotent`'s
 * insert-or-select-existing shape. */
export async function raiseExceptionIdempotent(companyId: string, input: NewBankingException): Promise<BankingException> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banking_exceptions")
    .insert({
      company_id: companyId,
      bank_transaction_id: input.bankTransactionId,
      exception_type: input.exceptionType,
      reason: input.reason,
      evidence: input.evidence,
      recommended_action: input.recommendedAction,
      status: "Open",
    })
    .select("*")
    .single<BankingExceptionRow>();

  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      const { data: existing, error: selectError } = await supabase
        .from("banking_exceptions")
        .select("*")
        .eq("bank_transaction_id", input.bankTransactionId)
        .eq("exception_type", input.exceptionType)
        .eq("status", "Open")
        .single<BankingExceptionRow>();
      if (selectError) throw selectError;
      return bankingExceptionFromRow(existing);
    }
    throw error;
  }
  return bankingExceptionFromRow(data);
}

export async function resolveException(companyId: string, exceptionId: number, status: "Resolved" | "Dismissed", resolvedBy: string, note: string): Promise<BankingException> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banking_exceptions")
    .update({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq("company_id", companyId)
    .eq("id", exceptionId)
    .select("*")
    .single<BankingExceptionRow>();
  if (error) throw error;
  return bankingExceptionFromRow(data);
}
