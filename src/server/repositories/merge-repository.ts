/**
 * Repository layer for Merchant/Customer/Supplier merges. See
 * supabase/migrations/0023_matching_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { merchantMergeFromRow, partyMergeFromRow, type MerchantMergeRow, type PartyMergeRow } from "@/server/matching/mappers";
import type { MerchantMerge, PartyMerge, PartyType } from "@/server/matching/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the established convention this follows.
const LIST_CAP = 10_000;

export async function recordMerchantMerge(companyId: string, survivingMerchantId: number, mergedMerchantId: number, mergedMerchantName: string, transactionsRepointed: number, performedBy: string): Promise<MerchantMerge> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("merchant_merges")
    .insert({ company_id: companyId, surviving_merchant_id: survivingMerchantId, merged_merchant_id: mergedMerchantId, merged_merchant_name: mergedMerchantName, transactions_repointed: transactionsRepointed, performed_by: performedBy })
    .select("*")
    .single<MerchantMergeRow>();
  if (error) throw error;
  return merchantMergeFromRow(data);
}

export async function listMerchantMerges(companyId: string): Promise<MerchantMerge[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("merchant_merges").select("*").eq("company_id", companyId).order("performed_at", { ascending: false }).limit(LIST_CAP).returns<MerchantMergeRow[]>();
  if (error) throw error;
  return data.map(merchantMergeFromRow);
}

export async function recordPartyMerge(companyId: string, partyType: PartyType, survivingPartyId: number, mergedPartyId: number, mergedPartyName: string, performedBy: string): Promise<PartyMerge> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("party_merges")
    .insert({ company_id: companyId, party_type: partyType, surviving_party_id: survivingPartyId, merged_party_id: mergedPartyId, merged_party_name: mergedPartyName, performed_by: performedBy })
    .select("*")
    .single<PartyMergeRow>();
  if (error) throw error;
  return partyMergeFromRow(data);
}

export async function listPartyMerges(companyId: string): Promise<PartyMerge[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("party_merges").select("*").eq("company_id", companyId).order("performed_at", { ascending: false }).limit(LIST_CAP).returns<PartyMergeRow[]>();
  if (error) throw error;
  return data.map(partyMergeFromRow);
}

export type SupplierMergeRepointCounts = {
  bills: number;
  bankTransactions: number;
  purchaseOrders: number;
  goodsReceivedNotes: number;
  payments: number;
  stockItems: number;
  merchants: number;
  bankTransactionSplits: number;
  fixedAssets: number;
  openingBalanceEntries: number;
  supplierContacts: number;
  supplierAddresses: number;
};

/** Phase 33 — the real Supplier merge, replacing the previous
 * `recordPartyMerge`-only no-op for this entity type (that function never
 * repointed a single foreign key or deactivated the duplicate — see
 * migration 0090's own docstring for the full investigation). Runs
 * `fn_merge_supplier` (0090_atomic_supplier_merge.sql) via RPC so every
 * repoint, the deactivation, and the `party_merges` audit row all commit
 * or roll back together as one Postgres transaction — not a sequence of
 * separate JS-side calls that could half-apply.
 *
 * Phase 33A — now called by `merge-service.ts::mergeSuppliers`, itself
 * called only from the explicit-survivor-choice UI
 * (`supplier-merge-dialog.tsx`). */
export async function mergeSupplierAtomic(companyId: string, survivorId: number, duplicateId: number, performedBy: string): Promise<SupplierMergeRepointCounts & { duplicateName: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_merge_supplier", {
    p_company_id: companyId,
    p_survivor_id: survivorId,
    p_duplicate_id: duplicateId,
    p_performed_by: performedBy,
  });
  if (error) throw error;
  // Untyped RPC result — same convention as `transaction-explorer-repository.ts`'s
  // `fn_apply_ai_classification` call.
  const result = data as unknown as SupplierMergeRepointCounts & { duplicateName: string };
  return result;
}

/** Phase 33A — the "Number of linked records" figure the merge dialog
 * shows for each candidate supplier before the user commits to a
 * survivor. Read-only: one small `count`-only query per table this
 * supplier could be referenced from — the exact same table list
 * `fn_merge_supplier` repoints, kept in sync deliberately (see that
 * migration's own docstring for why each one is there). Run in parallel
 * since these are independent, cheap `head: true` count queries, not a
 * join. */
export async function getSupplierLinkedRecordCount(companyId: string, supplierId: number): Promise<number> {
  const supabase = await createClient();
  const scoped: [string, string][] = [
    ["ae_imported_bills", "supplier_id"],
    ["ae_bank_transactions", "matched_supplier_id"],
    ["purchase_orders", "supplier_id"],
    ["goods_received_notes", "supplier_id"],
    ["supplier_payments", "supplier_id"],
    ["stock_items", "preferred_supplier_id"],
    ["merchants", "default_supplier_id"],
    ["bank_transaction_splits", "supplier_id"],
    ["fixed_assets", "supplier_id"],
    ["opening_balance_entries", "supplier_id"],
  ];
  const counts = await Promise.all(
    scoped.map(async ([table, column]) => {
      const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("company_id", companyId).eq(column, supplierId);
      if (error) throw error;
      return count ?? 0;
    }),
  );
  // `supplier_contacts`/`supplier_addresses` have no `company_id` column
  // of their own — scoped by `supplier_id` alone, same as the RPC's own
  // repoint statements for these two tables (see that function's own
  // comment on why no extra scoping is needed here).
  const [contactsResult, addressesResult] = await Promise.all([
    supabase.from("supplier_contacts").select("id", { count: "exact", head: true }).eq("supplier_id", supplierId),
    supabase.from("supplier_addresses").select("id", { count: "exact", head: true }).eq("supplier_id", supplierId),
  ]);
  if (contactsResult.error) throw contactsResult.error;
  if (addressesResult.error) throw addressesResult.error;

  return counts.reduce((sum, n) => sum + n, 0) + (contactsResult.count ?? 0) + (addressesResult.count ?? 0);
}
