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
