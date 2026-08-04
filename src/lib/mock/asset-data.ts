/**
 * Preview Mode seed data for the Fixed Assets & Asset Intelligence
 * Platform (Module 11). Field shapes match the real domain types
 * exactly. Accumulated depreciation is DERIVED by running the real
 * `runDepreciationForAsset` month-by-month from each asset's in-service
 * date up to `MOCK_TODAY` — the same "derived, not hand-typed"
 * discipline `general-ledger-data.ts`'s `MOCK_TRIAL_BALANCE` and
 * `audit-data.ts`'s findings already established. Asset Findings are
 * likewise derived by running the real `buildAssetIntelligence` engine
 * against this same mock data.
 */

import type { AssetClass, AssetFinding, AssetLifecycleEvent, DepreciationRun, DepreciationRunLine, FixedAsset } from "@/server/assets/types";
import { runDepreciationForAsset, type DepreciableAsset } from "@/server/assets/depreciation-engine";
import { buildAssetIntelligence, type AssetSnapshot } from "@/server/assets/asset-intelligence-engine";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;
const MOCK_TODAY = "2026-07-31";

export const MOCK_ASSET_CLASSES: AssetClass[] = [
  { id: 1, companyId: COMPANY_ID, name: "Vehicles", code: "VEH", defaultDepreciationMethod: "StraightLine", defaultUsefulLifeMonths: 60, isActive: true, createdAt: "2022-01-01T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, name: "Office Equipment", code: "OFF", defaultDepreciationMethod: "DiminishingBalance", defaultUsefulLifeMonths: 36, isActive: true, createdAt: "2022-01-01T09:00:00Z" },
  { id: 3, companyId: COMPANY_ID, name: "Warehouse Equipment", code: "WHE", defaultDepreciationMethod: "StraightLine", defaultUsefulLifeMonths: 48, isActive: true, createdAt: "2022-01-01T09:00:00Z" },
];

function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

/** Derives real accumulated depreciation as of `MOCK_TODAY` by running
 * the actual engine once per elapsed month — not a shortcut formula.
 * Also returns the final month's own amount, so the mock Depreciation
 * Run's lines don't need to re-derive it a second time. */
function accumulateDepreciation(asset: DepreciableAsset & { inServiceDate: string }): { total: number; lastMonthAmount: number } {
  const months = monthsBetween(asset.inServiceDate, MOCK_TODAY);
  let working = { ...asset, accumulatedDepreciation: asset.accumulatedDepreciation };
  let cursor = asset.inServiceDate;
  let lastMonthAmount = 0;

  for (let i = 0; i < months; i++) {
    const periodStart = `${cursor.slice(0, 7)}-01`;
    const nextMonth = new Date(Date.UTC(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)), 1));
    const periodEnd = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const result = runDepreciationForAsset(working, periodStart, periodEnd);
    working = { ...working, accumulatedDepreciation: result.accumulatedDepreciationAfter };
    lastMonthAmount = result.amount;
    cursor = periodEnd;
  }
  return { total: working.accumulatedDepreciation, lastMonthAmount };
}

const vehicleBase = { cost: 350000, residualValue: 35000, usefulLifeMonths: 60, depreciationMethod: "StraightLine" as const, diminishingBalanceRatePercent: 0, unitsOfProductionLifeUnits: 0, accumulatedDepreciation: 0, accumulatedImpairment: 0, inServiceDate: "2022-02-01", status: "Active" };
const officeBase = { cost: 45000, residualValue: 4500, usefulLifeMonths: 36, depreciationMethod: "DiminishingBalance" as const, diminishingBalanceRatePercent: 30, unitsOfProductionLifeUnits: 0, accumulatedDepreciation: 0, accumulatedImpairment: 0, inServiceDate: "2023-06-01", status: "Active" };
const forkliftBase = { cost: 180000, residualValue: 18000, usefulLifeMonths: 48, depreciationMethod: "StraightLine" as const, diminishingBalanceRatePercent: 0, unitsOfProductionLifeUnits: 0, accumulatedDepreciation: 0, accumulatedImpairment: 0, inServiceDate: "2019-01-01", status: "Active" };
const printerBase = { cost: 5200, residualValue: 500, usefulLifeMonths: 36, depreciationMethod: "StraightLine" as const, diminishingBalanceRatePercent: 0, unitsOfProductionLifeUnits: 0, accumulatedDepreciation: 0, accumulatedImpairment: 0, inServiceDate: "2024-03-01", status: "Idle" };

const vehicleDepreciation = accumulateDepreciation(vehicleBase);
const officeDepreciation = accumulateDepreciation(officeBase);
const forkliftDepreciation = accumulateDepreciation(forkliftBase);
const printerDepreciation = accumulateDepreciation(printerBase);

export const MOCK_FIXED_ASSETS: FixedAsset[] = [
  {
    id: 1, companyId: COMPANY_ID, assetNumber: "FA000001", description: "Delivery Vehicle — Toyota Hilux", assetClassId: 1, category: "Vehicle", assetGroup: "Delivery Fleet",
    purchaseDate: "2022-01-20", inServiceDate: vehicleBase.inServiceDate, cost: vehicleBase.cost, residualValue: vehicleBase.residualValue, usefulLifeMonths: vehicleBase.usefulLifeMonths,
    depreciationMethod: "StraightLine", diminishingBalanceRatePercent: 0, unitsOfProductionLifeUnits: 0, unitsOfProductionUnitsToDate: 0,
    accumulatedDepreciation: vehicleDepreciation.total, accumulatedImpairment: 0,
    supplierId: null, branchId: null, departmentId: null, costCentreId: null, projectId: null,
    location: "Head Office", custodian: "J. Adams", status: "Active", statusChangedAt: "2022-02-01T09:00:00Z",
    serialNumber: "VIN-4471829", warrantyExpiryDate: "2026-08-15", insuranceProvider: "Santam", insurancePolicyNumber: "POL-88213", insuranceExpiryDate: "2026-08-20",
    imageUrl: "", documentUrl: "", acquisitionJournalId: null, createdBy: "System", createdAt: "2022-01-20T09:00:00Z", updatedAt: "2022-01-20T09:00:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, assetNumber: "FA000002", description: "Office Server & Workstations", assetClassId: 2, category: "IT Equipment", assetGroup: "Head Office IT",
    purchaseDate: "2023-05-20", inServiceDate: officeBase.inServiceDate, cost: officeBase.cost, residualValue: officeBase.residualValue, usefulLifeMonths: officeBase.usefulLifeMonths,
    depreciationMethod: "DiminishingBalance", diminishingBalanceRatePercent: 30, unitsOfProductionLifeUnits: 0, unitsOfProductionUnitsToDate: 0,
    accumulatedDepreciation: officeDepreciation.total, accumulatedImpairment: 0,
    supplierId: null, branchId: null, departmentId: null, costCentreId: null, projectId: null,
    location: "Head Office", custodian: "IT Department", status: "Active", statusChangedAt: "2023-06-01T09:00:00Z",
    serialNumber: "SRV-2201", warrantyExpiryDate: "2026-06-01", insuranceProvider: "", insurancePolicyNumber: "", insuranceExpiryDate: null,
    imageUrl: "", documentUrl: "", acquisitionJournalId: null, createdBy: "System", createdAt: "2023-05-20T09:00:00Z", updatedAt: "2023-05-20T09:00:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, assetNumber: "FA000003", description: "Warehouse Forklift", assetClassId: 3, category: "Warehouse Equipment", assetGroup: "Materials Handling",
    purchaseDate: "2018-12-15", inServiceDate: forkliftBase.inServiceDate, cost: forkliftBase.cost, residualValue: forkliftBase.residualValue, usefulLifeMonths: forkliftBase.usefulLifeMonths,
    depreciationMethod: "StraightLine", diminishingBalanceRatePercent: 0, unitsOfProductionLifeUnits: 0, unitsOfProductionUnitsToDate: 0,
    accumulatedDepreciation: forkliftDepreciation.total, accumulatedImpairment: 0,
    supplierId: null, branchId: null, departmentId: null, costCentreId: null, projectId: null,
    location: "Warehouse", custodian: "Warehouse Supervisor", status: "Active", statusChangedAt: "2019-01-01T09:00:00Z",
    serialNumber: "FLT-0091", warrantyExpiryDate: "2020-01-01", insuranceProvider: "Santam", insurancePolicyNumber: "POL-55210", insuranceExpiryDate: "2027-01-01",
    imageUrl: "", documentUrl: "", acquisitionJournalId: null, createdBy: "System", createdAt: "2018-12-15T09:00:00Z", updatedAt: "2018-12-15T09:00:00Z",
  },
  {
    id: 4, companyId: COMPANY_ID, assetNumber: "FA000004", description: "Spare Office Printer", assetClassId: 2, category: "IT Equipment", assetGroup: "Head Office IT",
    purchaseDate: "2024-03-01", inServiceDate: "2024-03-01", cost: 5200, residualValue: 500, usefulLifeMonths: 36,
    depreciationMethod: "StraightLine", diminishingBalanceRatePercent: 0, unitsOfProductionLifeUnits: 0, unitsOfProductionUnitsToDate: 0,
    accumulatedDepreciation: printerDepreciation.total,
    accumulatedImpairment: 0,
    supplierId: null, branchId: null, departmentId: null, costCentreId: null, projectId: null,
    location: "Storage", custodian: "IT Department", status: "Idle", statusChangedAt: "2026-03-15T09:00:00Z",
    serialNumber: "PRN-3321", warrantyExpiryDate: null, insuranceProvider: "", insurancePolicyNumber: "", insuranceExpiryDate: null,
    imageUrl: "", documentUrl: "", acquisitionJournalId: null, createdBy: "System", createdAt: "2024-03-01T09:00:00Z", updatedAt: "2024-03-01T09:00:00Z",
  },
];

export const MOCK_ASSET_LIFECYCLE_EVENTS: AssetLifecycleEvent[] = [
  { id: 1, companyId: COMPANY_ID, assetId: 1, eventType: "Acquisition", eventDate: "2022-01-20", description: "Acquired for 350000", amount: 350000, journalId: null, metadata: {}, performedBy: "System", createdAt: "2022-01-20T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, assetId: 1, eventType: "Capitalisation", eventDate: "2022-02-01", description: "Asset capitalised and placed into service.", amount: 0, journalId: null, metadata: {}, performedBy: "System", createdAt: "2022-02-01T09:00:00Z" },
  { id: 3, companyId: COMPANY_ID, assetId: 2, eventType: "Acquisition", eventDate: "2023-05-20", description: "Acquired for 45000", amount: 45000, journalId: null, metadata: {}, performedBy: "System", createdAt: "2023-05-20T09:00:00Z" },
  { id: 4, companyId: COMPANY_ID, assetId: 3, eventType: "Acquisition", eventDate: "2018-12-15", description: "Acquired for 180000", amount: 180000, journalId: null, metadata: {}, performedBy: "System", createdAt: "2018-12-15T09:00:00Z" },
  { id: 5, companyId: COMPANY_ID, assetId: 4, eventType: "Transfer", eventDate: "2026-03-15", description: "Marked Idle — no longer in active use.", amount: 0, journalId: null, metadata: { from: { location: "Head Office" }, to: { location: "Storage" } }, performedBy: "IT Department", createdAt: "2026-03-15T09:00:00Z" },
];

// ---------------------------------------------------------------------
// Depreciation Runs — one real, illustrative posted run.
// ---------------------------------------------------------------------

const LAST_MONTH_BY_ASSET_ID: Record<number, number> = {
  1: vehicleDepreciation.lastMonthAmount,
  2: officeDepreciation.lastMonthAmount,
  3: forkliftDepreciation.lastMonthAmount,
};

export const MOCK_DEPRECIATION_RUNS: DepreciationRun[] = [
  {
    id: 1,
    companyId: COMPANY_ID,
    runDate: "2026-07-31",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    status: "Posted",
    totalAmount: Math.round(Object.values(LAST_MONTH_BY_ASSET_ID).reduce((sum, v) => sum + v, 0) * 100) / 100,
    journalId: null,
    createdBy: "System",
    createdAt: "2026-07-31T09:00:00Z",
  },
];

export const MOCK_DEPRECIATION_RUN_LINES: DepreciationRunLine[] = MOCK_FIXED_ASSETS.filter((a) => a.status === "Active").map((a, i) => ({
  id: i + 1,
  runId: 1,
  assetId: a.id,
  depreciationAmount: LAST_MONTH_BY_ASSET_ID[a.id] ?? 0,
  accumulatedDepreciationAfter: a.accumulatedDepreciation,
  netBookValueAfter: a.cost - a.accumulatedDepreciation - a.accumulatedImpairment,
  createdAt: "2026-07-31T09:00:00Z",
}));

// ---------------------------------------------------------------------
// Findings — derived by running the real Asset Intelligence engine
// against the mock assets above.
// ---------------------------------------------------------------------

function toSnapshot(asset: FixedAsset): AssetSnapshot {
  return {
    id: asset.id, assetNumber: asset.assetNumber, description: asset.description, cost: asset.cost, residualValue: asset.residualValue,
    usefulLifeMonths: asset.usefulLifeMonths, depreciationMethod: asset.depreciationMethod, diminishingBalanceRatePercent: asset.diminishingBalanceRatePercent,
    unitsOfProductionLifeUnits: asset.unitsOfProductionLifeUnits, accumulatedDepreciation: asset.accumulatedDepreciation, accumulatedImpairment: asset.accumulatedImpairment,
    inServiceDate: asset.inServiceDate, status: asset.status, statusChangedAt: asset.statusChangedAt, warrantyExpiryDate: asset.warrantyExpiryDate, insuranceExpiryDate: asset.insuranceExpiryDate,
  };
}

let findingIdCounter = 1;
export const MOCK_ASSET_FINDINGS: AssetFinding[] = MOCK_FIXED_ASSETS.flatMap((asset) =>
  buildAssetIntelligence(toSnapshot(asset), { todayIso: MOCK_TODAY, highValueThreshold: 100_000, capitalisationThreshold: 7_000, warrantyWindowDays: 60, insuranceWindowDays: 60 }).map((f) => ({
    id: findingIdCounter++,
    companyId: COMPANY_ID,
    assetId: asset.id,
    findingType: f.findingType,
    confidence: f.confidence,
    reason: f.reason,
    evidence: f.evidence,
    suggestedAction: f.suggestedAction,
    status: "Open" as const,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-07-31T09:00:00Z",
  })),
);
