/**
 * Application Service for Asset Intelligence — fetches real Asset
 * Register + Depreciation Run data and hands it to the pure detectors in
 * `asset-intelligence-engine.ts`, then persists results via the
 * idempotent `raiseAssetFindingIdempotent`.
 */

import * as assetRepo from "@/server/repositories/fixed-asset-repository";
import * as runRepo from "@/server/repositories/depreciation-run-repository";
import * as findingRepo from "@/server/repositories/asset-finding-repository";
import { computeMonthlyDepreciationAmount, computeNetBookValue } from "@/server/assets/depreciation-engine";
import { buildAssetIntelligence, type AssetSnapshot } from "@/server/assets/asset-intelligence-engine";
import type { AssetFinding } from "@/server/assets/types";

export const listAssetFindings = findingRepo.listAssetFindings;
export const resolveAssetFinding = findingRepo.resolveAssetFinding;

const DEFAULT_HIGH_VALUE_THRESHOLD = 100_000;
const DEFAULT_CAPITALISATION_THRESHOLD = 7_000;
const RECENT_RUNS_TO_CHECK = 2;

export async function runAssetIntelligence(
  companyId: string,
  todayIso: string,
  highValueThreshold = DEFAULT_HIGH_VALUE_THRESHOLD,
  capitalisationThreshold = DEFAULT_CAPITALISATION_THRESHOLD,
): Promise<{ findingsRaised: number }> {
  const assets = await assetRepo.listFixedAssets(companyId);
  let findingsRaised = 0;

  for (const asset of assets) {
    const recentLines = await runRepo.listDepreciationRunLinesForAsset(companyId, asset.id, RECENT_RUNS_TO_CHECK);
    const recentDepreciationAmounts = recentLines.map((l) => l.depreciationAmount);
    const currentNetBookValue = computeNetBookValue(asset.cost, asset.accumulatedDepreciation, asset.accumulatedImpairment);
    const expectedLastDepreciationAmount = computeMonthlyDepreciationAmount(asset, currentNetBookValue);
    const actualLastDepreciationAmount = recentLines[0]?.depreciationAmount ?? 0;

    const snapshot: AssetSnapshot = {
      id: asset.id,
      assetNumber: asset.assetNumber,
      description: asset.description,
      cost: asset.cost,
      residualValue: asset.residualValue,
      usefulLifeMonths: asset.usefulLifeMonths,
      depreciationMethod: asset.depreciationMethod,
      diminishingBalanceRatePercent: asset.diminishingBalanceRatePercent,
      unitsOfProductionLifeUnits: asset.unitsOfProductionLifeUnits,
      accumulatedDepreciation: asset.accumulatedDepreciation,
      accumulatedImpairment: asset.accumulatedImpairment,
      inServiceDate: asset.inServiceDate,
      status: asset.status,
      statusChangedAt: asset.statusChangedAt,
      warrantyExpiryDate: asset.warrantyExpiryDate,
      insuranceExpiryDate: asset.insuranceExpiryDate,
    };

    const findings = buildAssetIntelligence(snapshot, {
      todayIso,
      highValueThreshold,
      capitalisationThreshold,
      actualLastDepreciationAmount: recentLines.length > 0 ? actualLastDepreciationAmount : undefined,
      expectedLastDepreciationAmount: recentLines.length > 0 ? expectedLastDepreciationAmount : undefined,
      recentDepreciationAmounts,
    });

    for (const finding of findings) {
      await findingRepo.raiseAssetFindingIdempotent(companyId, { assetId: asset.id, ...finding });
      findingsRaised += 1;
    }
  }

  return { findingsRaised };
}

export function summarizeOpenFindingsByAsset(findings: AssetFinding[]): Map<number, AssetFinding[]> {
  const map = new Map<number, AssetFinding[]>();
  for (const f of findings.filter((f) => f.status === "Open")) {
    map.set(f.assetId, [...(map.get(f.assetId) ?? []), f]);
  }
  return map;
}
