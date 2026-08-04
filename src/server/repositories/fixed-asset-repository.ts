/**
 * Repository layer for the Asset Register. See
 * supabase/migrations/0018_fixed_assets_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { fixedAssetFromRow, type FixedAssetRow } from "@/server/assets/mappers";
import type { AssetStatus, DepreciationMethod, FixedAsset } from "@/server/assets/types";

export async function listFixedAssets(companyId: string, status?: AssetStatus): Promise<FixedAsset[]> {
  const supabase = await createClient();
  let query = supabase.from("fixed_assets").select("*").eq("company_id", companyId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("asset_number").returns<FixedAssetRow[]>();
  if (error) throw error;
  return data.map(fixedAssetFromRow);
}

export async function getFixedAsset(companyId: string, assetId: number): Promise<FixedAsset | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("fixed_assets").select("*").eq("company_id", companyId).eq("id", assetId).maybeSingle<FixedAssetRow>();
  if (error) throw error;
  return data ? fixedAssetFromRow(data) : null;
}

export async function nextAssetNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("fixed_assets").select("*", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `FA${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export type NewFixedAsset = {
  assetNumber: string;
  description: string;
  assetClassId?: number | null;
  category?: string;
  assetGroup?: string;
  purchaseDate?: string | null;
  inServiceDate?: string | null;
  cost: number;
  residualValue?: number;
  usefulLifeMonths: number;
  depreciationMethod?: DepreciationMethod;
  diminishingBalanceRatePercent?: number;
  unitsOfProductionLifeUnits?: number;
  supplierId?: number | null;
  branchId?: number | null;
  departmentId?: number | null;
  costCentreId?: number | null;
  projectId?: number | null;
  location?: string;
  custodian?: string;
  serialNumber?: string;
  warrantyExpiryDate?: string | null;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  insuranceExpiryDate?: string | null;
  imageUrl?: string;
  documentUrl?: string;
  createdBy?: string;
};

export async function createFixedAsset(companyId: string, input: NewFixedAsset): Promise<FixedAsset> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fixed_assets")
    .insert({
      company_id: companyId,
      asset_number: input.assetNumber,
      description: input.description,
      asset_class_id: input.assetClassId ?? null,
      category: input.category ?? "",
      asset_group: input.assetGroup ?? "",
      purchase_date: input.purchaseDate ?? null,
      in_service_date: input.inServiceDate ?? null,
      cost: input.cost,
      residual_value: input.residualValue ?? 0,
      useful_life_months: input.usefulLifeMonths,
      depreciation_method: input.depreciationMethod ?? "StraightLine",
      diminishing_balance_rate_percent: input.diminishingBalanceRatePercent ?? 0,
      units_of_production_life_units: input.unitsOfProductionLifeUnits ?? 0,
      supplier_id: input.supplierId ?? null,
      branch_id: input.branchId ?? null,
      department_id: input.departmentId ?? null,
      cost_centre_id: input.costCentreId ?? null,
      project_id: input.projectId ?? null,
      location: input.location ?? "",
      custodian: input.custodian ?? "",
      serial_number: input.serialNumber ?? "",
      warranty_expiry_date: input.warrantyExpiryDate ?? null,
      insurance_provider: input.insuranceProvider ?? "",
      insurance_policy_number: input.insurancePolicyNumber ?? "",
      insurance_expiry_date: input.insuranceExpiryDate ?? null,
      image_url: input.imageUrl ?? "",
      document_url: input.documentUrl ?? "",
      created_by: input.createdBy ?? "System",
    })
    .select("*")
    .single<FixedAssetRow>();
  if (error) throw error;
  return fixedAssetFromRow(data);
}

export type UpdatableFixedAssetFields = Partial<{
  description: string;
  asset_class_id: number | null;
  category: string;
  asset_group: string;
  purchase_date: string | null;
  in_service_date: string | null;
  cost: number;
  residual_value: number;
  useful_life_months: number;
  depreciation_method: DepreciationMethod;
  diminishing_balance_rate_percent: number;
  units_of_production_life_units: number;
  units_of_production_units_to_date: number;
  accumulated_depreciation: number;
  accumulated_impairment: number;
  supplier_id: number | null;
  branch_id: number | null;
  department_id: number | null;
  cost_centre_id: number | null;
  project_id: number | null;
  location: string;
  custodian: string;
  status: AssetStatus;
  status_changed_at: string;
  serial_number: string;
  warranty_expiry_date: string | null;
  insurance_provider: string;
  insurance_policy_number: string;
  insurance_expiry_date: string | null;
  image_url: string;
  document_url: string;
  acquisition_journal_id: number | null;
}>;

export async function updateFixedAsset(companyId: string, assetId: number, fields: UpdatableFixedAssetFields): Promise<FixedAsset> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fixed_assets")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", assetId)
    .select("*")
    .single<FixedAssetRow>();
  if (error) throw error;
  return fixedAssetFromRow(data);
}

export async function setFixedAssetStatus(companyId: string, assetId: number, status: AssetStatus): Promise<FixedAsset> {
  return updateFixedAsset(companyId, assetId, { status, status_changed_at: new Date().toISOString() });
}
