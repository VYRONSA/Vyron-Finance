/**
 * Shared Fixed Assets dashboard math — the single place Total Asset
 * Value/Net Book Value/Depreciation This Month/Assets Due for
 * Replacement/Warranty Expiry/Impairment Alerts/Asset Health Score are
 * computed, so the Fixed Assets workspace, Executive Dashboard, and
 * Auditor Workspace can never quietly restate the same numbers
 * differently. Mirrors `vat-summary-service.ts`/
 * `audit-dashboard-summary-service.ts`. Pure — unit tested.
 */

import { computeNetBookValue } from "@/server/assets/depreciation-engine";
import type { AssetFinding, AssetFindingType, FixedAsset } from "@/server/assets/types";

export type AssetDashboardSummary = {
  totalAssetValue: number;
  netBookValue: number;
  depreciationThisMonth: number;
  assetsDueForReplacementCount: number;
  warrantyExpiryCount: number;
  impairmentAlertCount: number;
  assetHealthScore: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 100, minus a real penalty per open finding (weighted by how material
 * the signal is) — every point deducted traces to a specific, visible
 * finding, same discipline as `vat-summary-service.ts::computeComplianceScore`. */
const FINDING_PENALTY: Record<AssetFindingType, number> = {
  OverdueReplacement: 6,
  Underutilisation: 3,
  HighMaintenanceRisk: 5,
  WarrantyExpiry: 2,
  InsuranceExpiry: 4,
  UnusualDepreciation: 5,
  ImpairmentIndicator: 7,
  IdleAsset: 4,
  HighValueAsset: 0, // a classification, not a risk — no penalty
  CapitalisationAnomaly: 3,
};

export function computeAssetHealthScore(openFindings: AssetFinding[]): number {
  const penalty = openFindings.reduce((sum, f) => sum + (FINDING_PENALTY[f.findingType] ?? 3), 0);
  return Math.max(0, Math.round(100 - penalty));
}

export function buildAssetDashboardSummary(assets: FixedAsset[], findings: AssetFinding[], depreciationThisMonth: number): AssetDashboardSummary {
  const openFindings = findings.filter((f) => f.status === "Open");
  const activeAssets = assets.filter((a) => a.status !== "WrittenOff");

  const totalAssetValue = round2(activeAssets.reduce((sum, a) => sum + a.cost, 0));
  const netBookValue = round2(activeAssets.reduce((sum, a) => sum + computeNetBookValue(a.cost, a.accumulatedDepreciation, a.accumulatedImpairment), 0));

  return {
    totalAssetValue,
    netBookValue,
    depreciationThisMonth: round2(depreciationThisMonth),
    assetsDueForReplacementCount: openFindings.filter((f) => f.findingType === "OverdueReplacement").length,
    warrantyExpiryCount: openFindings.filter((f) => f.findingType === "WarrantyExpiry").length,
    impairmentAlertCount: openFindings.filter((f) => f.findingType === "ImpairmentIndicator").length,
    assetHealthScore: computeAssetHealthScore(openFindings),
  };
}
