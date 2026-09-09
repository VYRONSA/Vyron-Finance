/**
 * Repository layer for Branches (organisational locations — distinct
 * from `ae_bank_accounts.branch`'s bank-branch code). No reference-app
 * equivalent; genuinely new master data.
 */

import { createClient } from "@/lib/supabase/server";
import { branchFromRow, type BranchRow } from "@/server/company-management/mappers";
import type { Branch } from "@/server/company-management/types";

export async function listBranches(companyId: string): Promise<Branch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("branches").select("*").eq("company_id", companyId).order("name").returns<BranchRow[]>();
  if (error) throw error;
  return data.map(branchFromRow);
}

export type NewBranch = { name: string; code?: string; address?: string };

export async function createBranch(companyId: string, input: NewBranch): Promise<Branch> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .insert({ company_id: companyId, name: input.name, code: input.code ?? "", address: input.address ?? "" })
    .select("*")
    .single<BranchRow>();
  if (error) throw error;
  return branchFromRow(data);
}

export async function getBranch(companyId: string, branchId: number): Promise<Branch | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("branches").select("*").eq("company_id", companyId).eq("id", branchId).maybeSingle<BranchRow>();
  if (error) throw error;
  return data ? branchFromRow(data) : null;
}

export type UpdatableBranchFields = Partial<{ name: string; code: string; address: string }>;

export async function updateBranch(companyId: string, branchId: number, fields: UpdatableBranchFields): Promise<Branch> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .update(fields)
    .eq("company_id", companyId)
    .eq("id", branchId)
    .select("*")
    .single<BranchRow>();
  if (error) throw error;
  return branchFromRow(data);
}

export async function setBranchActive(companyId: string, branchId: number, isActive: boolean): Promise<Branch> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .update({ is_active: isActive })
    .eq("company_id", companyId)
    .eq("id", branchId)
    .select("*")
    .single<BranchRow>();
  if (error) throw error;
  return branchFromRow(data);
}
