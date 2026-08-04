/**
 * Repository layer for Merchants — the new business object the Banking
 * Rule Engine's "Recognise Merchant" pipeline step resolves a raw
 * `beneficiary` string to (see supabase/migrations/0013_banking_automation.sql).
 */

import { createClient } from "@/lib/supabase/server";
import { merchantFromRow, type MerchantRow } from "@/server/banking-rules/mappers";
import type { Merchant } from "@/server/banking-rules/types";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function listMerchants(companyId: string): Promise<Merchant[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("merchants").select("*").eq("company_id", companyId).order("name").limit(LIST_CAP).returns<MerchantRow[]>();
  if (error) throw error;
  return data.map(merchantFromRow);
}

export async function getMerchant(companyId: string, merchantId: number): Promise<Merchant | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("merchants")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", merchantId)
    .maybeSingle<MerchantRow>();
  if (error) throw error;
  return data ? merchantFromRow(data) : null;
}

/** Case-insensitive match against a merchant's own name OR any of its
 * aliases — the lookup `assignMerchant`/the Rule Engine's Merchant
 * resolution step both use before falling back to "no merchant yet". */
export async function findMerchantByBeneficiary(companyId: string, beneficiary: string): Promise<Merchant | null> {
  const supabase = await createClient();
  const normalized = beneficiary.trim().toLowerCase();
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("merchants")
    .select("*")
    .eq("company_id", companyId)
    .or(`name.ilike.${normalized},aliases.cs.{${normalized}}`)
    .returns<MerchantRow[]>();
  if (error) throw error;
  const exact = data.find((row) => row.name.toLowerCase() === normalized || (row.aliases ?? []).some((a) => a.toLowerCase() === normalized));
  return exact ? merchantFromRow(exact) : data[0] ? merchantFromRow(data[0]) : null;
}

export type NewMerchant = {
  name: string;
  aliases?: string[];
  defaultSupplierId?: number | null;
  defaultCustomerId?: number | null;
  defaultGlAccount?: string;
  defaultVatCode?: string;
  notes?: string;
};

export async function createMerchant(companyId: string, input: NewMerchant): Promise<Merchant> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("merchants")
    .insert({
      company_id: companyId,
      name: input.name,
      aliases: input.aliases ?? [],
      default_supplier_id: input.defaultSupplierId ?? null,
      default_customer_id: input.defaultCustomerId ?? null,
      default_gl_account: input.defaultGlAccount ?? "",
      default_vat_code: input.defaultVatCode ?? "",
      notes: input.notes ?? "",
    })
    .select("*")
    .single<MerchantRow>();
  if (error) throw error;
  return merchantFromRow(data);
}

export type UpdatableMerchantFields = Partial<{
  name: string;
  aliases: string[];
  default_supplier_id: number | null;
  default_customer_id: number | null;
  default_gl_account: string;
  default_vat_code: string;
  notes: string;
}>;

export async function updateMerchant(companyId: string, merchantId: number, fields: UpdatableMerchantFields): Promise<Merchant> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("merchants")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", merchantId)
    .select("*")
    .single<MerchantRow>();
  if (error) throw error;
  return merchantFromRow(data);
}

export async function getOrCreateMerchantByBeneficiary(companyId: string, beneficiary: string): Promise<Merchant> {
  const existing = await findMerchantByBeneficiary(companyId, beneficiary);
  if (existing) return existing;
  return createMerchant(companyId, { name: beneficiary });
}

/** Matching Platform (Module 14) — "Merge Merchants." Deletes the losing
 * record; `ae_bank_transactions.matched_merchant_id` uses `on delete set
 * null`, so any transaction not already re-pointed to the surviving
 * merchant first would lose its merchant link rather than error — the
 * merge service always re-points before calling this. */
export async function deleteMerchant(companyId: string, merchantId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("merchants").delete().eq("company_id", companyId).eq("id", merchantId);
  if (error) throw error;
}

/** Re-points every bank transaction currently matched to one merchant
 * onto another — the mechanical core of a merge. Returns how many rows
 * were repointed, for the audit-trail record. */
export async function repointTransactionsToMerchant(companyId: string, fromMerchantId: number, toMerchantId: number): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ae_bank_transactions")
    .update({ matched_merchant_id: toMerchantId })
    .eq("company_id", companyId)
    .eq("matched_merchant_id", fromMerchantId)
    .select("id")
    .limit(LIST_CAP);
  if (error) throw error;
  return data?.length ?? 0;
}
