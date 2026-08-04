/**
 * Row <-> domain type mappers for the Fixed Assets & Asset Intelligence
 * Platform (Module 11). See
 * supabase/migrations/0018_fixed_assets_platform.sql.
 */

import type { AssetClass, AssetFinding, AssetLifecycleEvent, DepreciationRun, DepreciationRunLine, FixedAsset } from "./types";

export type AssetClassRow = {
  id: number;
  company_id: string;
  name: string;
  code: string;
  default_depreciation_method: string;
  default_useful_life_months: number;
  is_active: boolean;
  created_at: string;
};

export function assetClassFromRow(row: AssetClassRow): AssetClass {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    code: row.code,
    defaultDepreciationMethod: row.default_depreciation_method as AssetClass["defaultDepreciationMethod"],
    defaultUsefulLifeMonths: row.default_useful_life_months,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export type FixedAssetRow = {
  id: number;
  company_id: string;
  asset_number: string;
  description: string;
  asset_class_id: number | null;
  category: string;
  asset_group: string;
  purchase_date: string | null;
  in_service_date: string | null;
  cost: number;
  residual_value: number;
  useful_life_months: number;
  depreciation_method: string;
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
  status: string;
  status_changed_at: string;
  serial_number: string;
  warranty_expiry_date: string | null;
  insurance_provider: string;
  insurance_policy_number: string;
  insurance_expiry_date: string | null;
  image_url: string;
  document_url: string;
  acquisition_journal_id: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function fixedAssetFromRow(row: FixedAssetRow): FixedAsset {
  return {
    id: row.id,
    companyId: row.company_id,
    assetNumber: row.asset_number,
    description: row.description,
    assetClassId: row.asset_class_id,
    category: row.category,
    assetGroup: row.asset_group,
    purchaseDate: row.purchase_date,
    inServiceDate: row.in_service_date,
    cost: Number(row.cost),
    residualValue: Number(row.residual_value),
    usefulLifeMonths: row.useful_life_months,
    depreciationMethod: row.depreciation_method as FixedAsset["depreciationMethod"],
    diminishingBalanceRatePercent: Number(row.diminishing_balance_rate_percent),
    unitsOfProductionLifeUnits: Number(row.units_of_production_life_units),
    unitsOfProductionUnitsToDate: Number(row.units_of_production_units_to_date),
    accumulatedDepreciation: Number(row.accumulated_depreciation),
    accumulatedImpairment: Number(row.accumulated_impairment),
    supplierId: row.supplier_id,
    branchId: row.branch_id,
    departmentId: row.department_id,
    costCentreId: row.cost_centre_id,
    projectId: row.project_id,
    location: row.location,
    custodian: row.custodian,
    status: row.status as FixedAsset["status"],
    statusChangedAt: row.status_changed_at,
    serialNumber: row.serial_number,
    warrantyExpiryDate: row.warranty_expiry_date,
    insuranceProvider: row.insurance_provider,
    insurancePolicyNumber: row.insurance_policy_number,
    insuranceExpiryDate: row.insurance_expiry_date,
    imageUrl: row.image_url,
    documentUrl: row.document_url,
    acquisitionJournalId: row.acquisition_journal_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type AssetLifecycleEventRow = {
  id: number;
  company_id: string;
  asset_id: number;
  event_type: string;
  event_date: string;
  description: string;
  amount: number;
  journal_id: number | null;
  metadata: unknown;
  performed_by: string;
  created_at: string;
};

export function assetLifecycleEventFromRow(row: AssetLifecycleEventRow): AssetLifecycleEvent {
  return {
    id: row.id,
    companyId: row.company_id,
    assetId: row.asset_id,
    eventType: row.event_type as AssetLifecycleEvent["eventType"],
    eventDate: row.event_date,
    description: row.description,
    amount: Number(row.amount),
    journalId: row.journal_id,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    performedBy: row.performed_by,
    createdAt: row.created_at,
  };
}

export type DepreciationRunRow = {
  id: number;
  company_id: string;
  run_date: string;
  period_start: string;
  period_end: string;
  status: string;
  total_amount: number;
  journal_id: number | null;
  created_by: string;
  created_at: string;
};

export function depreciationRunFromRow(row: DepreciationRunRow): DepreciationRun {
  return {
    id: row.id,
    companyId: row.company_id,
    runDate: row.run_date,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status as DepreciationRun["status"],
    totalAmount: Number(row.total_amount),
    journalId: row.journal_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export type DepreciationRunLineRow = {
  id: number;
  run_id: number;
  asset_id: number;
  depreciation_amount: number;
  accumulated_depreciation_after: number;
  net_book_value_after: number;
  created_at: string;
};

export function depreciationRunLineFromRow(row: DepreciationRunLineRow): DepreciationRunLine {
  return {
    id: row.id,
    runId: row.run_id,
    assetId: row.asset_id,
    depreciationAmount: Number(row.depreciation_amount),
    accumulatedDepreciationAfter: Number(row.accumulated_depreciation_after),
    netBookValueAfter: Number(row.net_book_value_after),
    createdAt: row.created_at,
  };
}

export type AssetFindingRow = {
  id: number;
  company_id: string;
  asset_id: number;
  finding_type: string;
  confidence: number;
  reason: string;
  evidence: string;
  suggested_action: string;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

export function assetFindingFromRow(row: AssetFindingRow): AssetFinding {
  return {
    id: row.id,
    companyId: row.company_id,
    assetId: row.asset_id,
    findingType: row.finding_type as AssetFinding["findingType"],
    confidence: Number(row.confidence),
    reason: row.reason,
    evidence: row.evidence,
    suggestedAction: row.suggested_action,
    status: row.status as AssetFinding["status"],
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
  };
}
