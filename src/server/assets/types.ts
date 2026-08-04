/**
 * Domain types for the Fixed Assets & Asset Intelligence Platform
 * (Module 11). See supabase/migrations/0018_fixed_assets_platform.sql.
 */

export type DepreciationMethod = "StraightLine" | "DiminishingBalance" | "UnitsOfProduction" | "Custom";
export const DEPRECIATION_METHODS: DepreciationMethod[] = ["StraightLine", "DiminishingBalance", "UnitsOfProduction", "Custom"];

export type AssetClass = {
  id: number;
  companyId: string;
  name: string;
  code: string;
  defaultDepreciationMethod: DepreciationMethod;
  defaultUsefulLifeMonths: number;
  isActive: boolean;
  createdAt: string;
};

export type AssetStatus = "Draft" | "Active" | "Idle" | "UnderMaintenance" | "Disposed" | "WrittenOff" | "Retired";
export const ASSET_STATUSES: AssetStatus[] = ["Draft", "Active", "Idle", "UnderMaintenance", "Disposed", "WrittenOff", "Retired"];

export type FixedAsset = {
  id: number;
  companyId: string;
  assetNumber: string;
  description: string;
  assetClassId: number | null;
  category: string;
  assetGroup: string;
  purchaseDate: string | null;
  inServiceDate: string | null;
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  diminishingBalanceRatePercent: number;
  unitsOfProductionLifeUnits: number;
  unitsOfProductionUnitsToDate: number;
  accumulatedDepreciation: number;
  accumulatedImpairment: number;
  supplierId: number | null;
  branchId: number | null;
  departmentId: number | null;
  costCentreId: number | null;
  projectId: number | null;
  location: string;
  custodian: string;
  status: AssetStatus;
  statusChangedAt: string;
  serialNumber: string;
  warrantyExpiryDate: string | null;
  insuranceProvider: string;
  insurancePolicyNumber: string;
  insuranceExpiryDate: string | null;
  /** Text-reference only — no file storage exists anywhere in this
   * codebase yet (confirmed by research); this is a URL/filename string,
   * the same disclosed convention `sourceFilename` already uses on
   * imported bank transactions. Real upload is a future extension
   * point, not fabricated here. */
  imageUrl: string;
  documentUrl: string;
  acquisitionJournalId: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** Client-derived, never persisted — see `depreciation-engine.ts::computeNetBookValue`. */
export type FixedAssetWithNetBookValue = FixedAsset & { netBookValue: number };

export type AssetLifecycleEventType = "Acquisition" | "Capitalisation" | "Improvement" | "Transfer" | "Revaluation" | "Impairment" | "Disposal" | "WriteOff" | "Retirement";
export const ASSET_LIFECYCLE_EVENT_TYPES: AssetLifecycleEventType[] = ["Acquisition", "Capitalisation", "Improvement", "Transfer", "Revaluation", "Impairment", "Disposal", "WriteOff", "Retirement"];

export type AssetLifecycleEvent = {
  id: number;
  companyId: string;
  assetId: number;
  eventType: AssetLifecycleEventType;
  eventDate: string;
  description: string;
  amount: number;
  journalId: number | null;
  metadata: Record<string, unknown>;
  performedBy: string;
  createdAt: string;
};

export type DepreciationRunStatus = "Draft" | "Posted";

export type DepreciationRun = {
  id: number;
  companyId: string;
  runDate: string;
  periodStart: string;
  periodEnd: string;
  status: DepreciationRunStatus;
  totalAmount: number;
  journalId: number | null;
  createdBy: string;
  createdAt: string;
};

export type DepreciationRunLine = {
  id: number;
  runId: number;
  assetId: number;
  depreciationAmount: number;
  accumulatedDepreciationAfter: number;
  netBookValueAfter: number;
  createdAt: string;
};

export type AssetFindingType =
  | "OverdueReplacement" | "Underutilisation" | "HighMaintenanceRisk" | "WarrantyExpiry" | "InsuranceExpiry"
  | "UnusualDepreciation" | "ImpairmentIndicator" | "IdleAsset" | "HighValueAsset" | "CapitalisationAnomaly";

export const ASSET_FINDING_TYPES: AssetFindingType[] = [
  "OverdueReplacement", "Underutilisation", "HighMaintenanceRisk", "WarrantyExpiry", "InsuranceExpiry",
  "UnusualDepreciation", "ImpairmentIndicator", "IdleAsset", "HighValueAsset", "CapitalisationAnomaly",
];

export type AssetFindingStatus = "Open" | "Resolved" | "Dismissed";

export type AssetFinding = {
  id: number;
  companyId: string;
  assetId: number;
  findingType: AssetFindingType;
  confidence: number;
  reason: string;
  evidence: string;
  suggestedAction: string;
  status: AssetFindingStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
};
