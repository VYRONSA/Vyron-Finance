/**
 * Repository layer for Split Transactions. See
 * supabase/migrations/0023_matching_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { bankTransactionSplitFromRow, type BankTransactionSplitRow } from "@/server/matching/mappers";
import type { BankTransactionSplit } from "@/server/matching/types";

export type NewBankTransactionSplit = {
  amount: number;
  description: string;
  glAccount: string;
  vatCode?: string;
  supplierId?: number | null;
  customerId?: number | null;
  projectId?: number | null;
  costCentreId?: number | null;
  departmentId?: number | null;
  branchId?: number | null;
  inventoryItemId?: number | null;
};

export async function listSplitsForTransaction(companyId: string, bankTransactionId: number): Promise<BankTransactionSplit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_transaction_splits")
    .select("*")
    .eq("company_id", companyId)
    .eq("bank_transaction_id", bankTransactionId)
    .order("line_order", { ascending: true })
    .returns<BankTransactionSplitRow[]>();
  if (error) throw error;
  return data.map(bankTransactionSplitFromRow);
}

/** Replaces the full split set for a transaction — a split is always
 * edited as a whole (the sum-to-total invariant only makes sense across
 * the complete line set), never patched line-by-line. */
export async function replaceSplits(companyId: string, bankTransactionId: number, lines: NewBankTransactionSplit[]): Promise<BankTransactionSplit[]> {
  const supabase = await createClient();
  const { error: deleteError } = await supabase.from("bank_transaction_splits").delete().eq("company_id", companyId).eq("bank_transaction_id", bankTransactionId);
  if (deleteError) throw deleteError;

  if (lines.length === 0) {
    await supabase.from("ae_bank_transactions").update({ is_split: false }).eq("company_id", companyId).eq("id", bankTransactionId);
    return [];
  }

  const { data, error } = await supabase
    .from("bank_transaction_splits")
    .insert(
      lines.map((line, index) => ({
        bank_transaction_id: bankTransactionId,
        company_id: companyId,
        line_order: index,
        amount: line.amount,
        description: line.description,
        gl_account: line.glAccount,
        vat_code: line.vatCode ?? "",
        supplier_id: line.supplierId ?? null,
        customer_id: line.customerId ?? null,
        project_id: line.projectId ?? null,
        cost_centre_id: line.costCentreId ?? null,
        department_id: line.departmentId ?? null,
        branch_id: line.branchId ?? null,
        inventory_item_id: line.inventoryItemId ?? null,
      })),
    )
    .select("*")
    .returns<BankTransactionSplitRow[]>();
  if (error) throw error;

  await supabase.from("ae_bank_transactions").update({ is_split: true }).eq("company_id", companyId).eq("id", bankTransactionId);
  return data.map(bankTransactionSplitFromRow);
}

export async function clearSplits(companyId: string, bankTransactionId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("bank_transaction_splits").delete().eq("company_id", companyId).eq("bank_transaction_id", bankTransactionId);
  if (error) throw error;
  await supabase.from("ae_bank_transactions").update({ is_split: false }).eq("company_id", companyId).eq("id", bankTransactionId);
}
