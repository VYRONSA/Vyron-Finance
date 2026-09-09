/**
 * Repository layer for the Opening Balances Management Centre — Pilot
 * Review Round 1, Phase 1. See supabase/migrations/0055_opening_balances_management.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { openingBalanceEntryFromRow, type OpeningBalanceEntryRow } from "@/server/opening-balances/mappers";
import type { EditOpeningBalanceEntry, NewOpeningBalanceEntry, OpeningBalanceEntry } from "@/server/opening-balances/types";

export async function listOpeningBalanceEntries(companyId: string): Promise<OpeningBalanceEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opening_balance_entries")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true })
    .returns<OpeningBalanceEntryRow[]>();
  if (error) throw error;
  return data.map(openingBalanceEntryFromRow);
}

export async function getOpeningBalanceEntry(companyId: string, entryId: number): Promise<OpeningBalanceEntry | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opening_balance_entries")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", entryId)
    .maybeSingle<OpeningBalanceEntryRow>();
  if (error) throw error;
  return data ? openingBalanceEntryFromRow(data) : null;
}

export async function createOpeningBalanceEntry(companyId: string, input: NewOpeningBalanceEntry, createdBy: string): Promise<OpeningBalanceEntry> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opening_balance_entries")
    .insert({
      company_id: companyId,
      category: input.category,
      account_code: input.accountCode ?? null,
      bank_account_id: input.bankAccountId ?? null,
      customer_id: input.customerId ?? null,
      supplier_id: input.supplierId ?? null,
      description: input.description,
      amount: input.amount,
      reference: input.reference ?? "",
      balance_date: input.balanceDate ?? new Date().toISOString().slice(0, 10),
      created_by: createdBy,
    })
    .select("*")
    .single<OpeningBalanceEntryRow>();
  if (error) throw error;
  return openingBalanceEntryFromRow(data);
}

export async function updateOpeningBalanceEntry(companyId: string, entryId: number, fields: EditOpeningBalanceEntry): Promise<OpeningBalanceEntry> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opening_balance_entries")
    .update({
      ...(fields.description !== undefined && { description: fields.description }),
      ...(fields.amount !== undefined && { amount: fields.amount }),
      ...(fields.reference !== undefined && { reference: fields.reference }),
      ...(fields.balanceDate !== undefined && { balance_date: fields.balanceDate }),
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("id", entryId)
    .select("*")
    .single<OpeningBalanceEntryRow>();
  if (error) throw error;
  return openingBalanceEntryFromRow(data);
}

export async function deleteOpeningBalanceEntry(companyId: string, entryId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("opening_balance_entries").delete().eq("company_id", companyId).eq("id", entryId);
  if (error) throw error;
}

export async function markOpeningBalanceEntriesPosted(companyId: string, entryIds: number[], journalId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("opening_balance_entries")
    .update({ status: "posted", journal_id: journalId, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .in("id", entryIds);
  if (error) throw error;
}
