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

export type NewAssetClass = { name: string; code?: string; defaultDepreciationMethod?: DepreciationMethod; defaultUsefulLifeMonths?: number };

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
    })
    .select("*")
    .single<AssetClassRow>();
  if (error) throw error;
  return assetClassFromRow(data);
}
