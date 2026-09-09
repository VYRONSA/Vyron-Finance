/**
 * Repository for `billing_support_notes` (migration `0050`) —
 * platform-scope only (Internal Billing Console's "Support Notes" tab).
 */

import { createClient } from "@/lib/supabase/server";
import { billingSupportNoteFromRow, type BillingSupportNoteRow } from "../mappers";
import type { BillingSupportNote } from "../types";

export async function listSupportNotes(billingAccountId: string): Promise<BillingSupportNote[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_support_notes").select("*").eq("billing_account_id", billingAccountId).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as BillingSupportNoteRow[];
  return rows.map(billingSupportNoteFromRow);
}

/** Platform-wide — every support note across every billing account, for
 * the Internal Billing Console's own Support Notes tab. RLS-only access
 * (this table's policy is platform-scope `for all` already, migration
 * `0050`). */
export async function listAllSupportNotes(limit = 100): Promise<BillingSupportNote[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_support_notes").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as BillingSupportNoteRow[];
  return rows.map(billingSupportNoteFromRow);
}

export async function addSupportNote(billingAccountId: string, note: string, createdBy: string): Promise<BillingSupportNote> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_support_notes")
    .insert({ billing_account_id: billingAccountId, note, created_by: createdBy })
    .select("*")
    .single<BillingSupportNoteRow>();
  if (error) throw error;
  return billingSupportNoteFromRow(data);
}
