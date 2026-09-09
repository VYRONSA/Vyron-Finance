/**
 * Repository layer for Asset Classes — real defaults (depreciation
 * method, useful life) an asset can inherit. See
 * supabase/migrations/0018_fixed_assets_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { assetClassFromRow, type AssetClassRow } from "@/server/assets/mappers";
import type { AssetClass, DepreciationMethod } from "@/server/assets/types";

export async function listAssetClasses(companyId: string): Promise<AssetClass[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("asset_classes").select("*").eq("company_id", companyId).order("name").returns<AssetClassRow[]>();
  if (error) throw error;
  return data.map(assetClassFromRow);
}

export async function getAssetClass(companyId: string, assetClassId: number): Promise<AssetClass | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("asset_classes").select("*").eq("company_id", companyId).eq("id", assetClassId).maybeSingle<AssetClassRow>();
  if (error) throw error;
  return data ? assetClassFromRow(data) : null;
}

export type NewAssetClass = {
  name: string;
  code?: string;
  defaultDepreciationMethod?: DepreciationMethod;
  defaultUsefulLifeMonths?: number;
  glAssetAccountCode?: string | null;
  glAccumulatedDepreciationAccountCode?: string | null;
  glDepreciationExpenseAccountCode?: string | null;
  glAccumulatedImpairmentAccountCode?: string | null;
  glGainOnDisposalAccountCode?: string | null;
  glLossOnDisposalAccountCode?: string | null;
};

export async function createAssetClass(companyId: string, input: NewAssetClass): Promise<AssetClass> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_classes")
    .insert({
      company_id: companyId,
      name: input.name,
      code: input.code ?? "",
      default_depreciation_method: input.defaultDepreciationMethod ?? "StraightLine",
      default_useful_life_months: input.defaultUsefulLifeMonths ?? 60,
      gl_asset_account_code: input.glAssetAccountCode ?? null,
      gl_accumulated_depreciation_account_code: input.glAccumulatedDepreciationAccountCode ?? null,
      gl_depreciation_expense_account_code: input.glDepreciationExpenseAccountCode ?? null,
      gl_accumulated_impairment_account_code: input.glAccumulatedImpairmentAccountCode ?? null,
      gl_gain_on_disposal_account_code: input.glGainOnDisposalAccountCode ?? null,
      gl_loss_on_disposal_account_code: input.glLossOnDisposalAccountCode ?? null,
    })
    .select("*")
    .single<AssetClassRow>();
  if (error) throw error;
  return assetClassFromRow(data);
}
