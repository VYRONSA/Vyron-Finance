/**
 * Asset Intelligence — pure, deterministic, computed-from-data signals
 * only (same honest framing as every other Intelligence module in this
 * platform: Banking, VAT, Financial, Executive, Audit). Every detector
 * takes real data the caller already fetched — no new data source is
 * invented, and where this platform genuinely lacks a real data source
 * (a maintenance-ticket system, usage-hour metering, market valuations),
 * the detector uses the closest defensible real proxy and says so in its
 * own doc comment, rather than fabricating a richer signal than the data
 * actually supports.
 */

import { computeNetBookValue, type DepreciableAsset } from "./depreciation-engine";
import type { AssetFindingType } from "./types";

export type AssetIntelligenceFinding = {
  findingType: AssetFindingType;
  confidence: number;
  reason: string;
  evidence: string;
  suggestedAction: string;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

function addMonths(dateIso: string, months: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate())).toISOString().slice(0, 10);
}

export type AssetSnapshot = DepreciableAsset & {
  id: number;
  assetNumber: string;
  description: string;
  cost: number;
  status: string;
  statusChangedAt: string;
  warrantyExpiryDate: string | null;
  insuranceExpiryDate: string | null;
};

/** Overdue Replacement — the asset has outlived its own planned useful
 * life but is still marked Active, never disposed or replaced. */
export function detectOverdueReplacement(asset: AssetSnapshot, todayIso: string): AssetIntelligenceFinding | null {
  if (asset.status !== "Active" || !asset.inServiceDate) return null;
  const plannedEndOfLife = addMonths(asset.inServiceDate, asset.usefulLifeMonths);
  if (todayIso <= plannedEndOfLife) return null;
  const overdueDays = daysBetween(plannedEndOfLife, todayIso);
  return {
    findingType: "OverdueReplacement",
    confidence: Math.min(0.9, 0.4 + overdueDays / 365),
    reason: `${asset.assetNumber} — ${asset.description} is ${overdueDays} day(s) past its planned end of useful life (${plannedEndOfLife}) and is still Active.`,
    evidence: `In service since ${asset.inServiceDate}, useful life ${asset.usefulLifeMonths} months.`,
    suggestedAction: "Assess whether this asset should be replaced, or whether its useful life should be formally extended.",
  };
}

const UNDERUTILISATION_MIN_DAYS = 30;
const IDLE_ASSET_MIN_DAYS = 90;

/** Underutilisation — an early warning: the asset has been Idle for a
 * meaningful but not yet extreme period. Distinct threshold from Idle
 * Asset below (same real data source — `status`/`statusChangedAt` — two
 * severities of the same underlying signal, not two different checks). */
export function detectUnderutilisation(asset: AssetSnapshot, todayIso: string): AssetIntelligenceFinding | null {
  if (asset.status !== "Idle") return null;
  const idleDays = daysBetween(asset.statusChangedAt.slice(0, 10), todayIso);
  if (idleDays < UNDERUTILISATION_MIN_DAYS || idleDays >= IDLE_ASSET_MIN_DAYS) return null;
  return {
    findingType: "Underutilisation",
    confidence: 0.5,
    reason: `${asset.assetNumber} — ${asset.description} has been Idle for ${idleDays} day(s).`,
    evidence: `Status changed to Idle on ${asset.statusChangedAt.slice(0, 10)}.`,
    suggestedAction: "Review whether this asset is still needed, or reassign it to an area with demand.",
  };
}

/** Idle Asset — confirmed, longer-term idleness (same data source as
 * Underutilisation, a higher severity threshold). */
export function detectIdleAsset(asset: AssetSnapshot, todayIso: string): AssetIntelligenceFinding | null {
  if (asset.status !== "Idle") return null;
  const idleDays = daysBetween(asset.statusChangedAt.slice(0, 10), todayIso);
  if (idleDays < IDLE_ASSET_MIN_DAYS) return null;
  return {
    findingType: "IdleAsset",
    confidence: Math.min(0.9, 0.5 + idleDays / 365),
    reason: `${asset.assetNumber} — ${asset.description} has been Idle for ${idleDays} day(s).`,
    evidence: `Status changed to Idle on ${asset.statusChangedAt.slice(0, 10)} and has not changed since.`,
    suggestedAction: "Consider disposal, transfer, or write-off — an asset idle this long is unlikely to return to service.",
  };
}

const MAINTENANCE_STUCK_MIN_DAYS = 14;

/** High Maintenance Risk — this platform has no maintenance-ticket
 * system (a real, disclosed gap, not fabricated); the closest real
 * proxy available is an asset that has been sitting in
 * `UnderMaintenance` status for an extended period. */
export function detectHighMaintenanceRisk(asset: AssetSnapshot, todayIso: string): AssetIntelligenceFinding | null {
  if (asset.status !== "UnderMaintenance") return null;
  const daysInMaintenance = daysBetween(asset.statusChangedAt.slice(0, 10), todayIso);
  if (daysInMaintenance < MAINTENANCE_STUCK_MIN_DAYS) return null;
  return {
    findingType: "HighMaintenanceRisk",
    confidence: Math.min(0.85, 0.4 + daysInMaintenance / 90),
    reason: `${asset.assetNumber} — ${asset.description} has been Under Maintenance for ${daysInMaintenance} day(s).`,
    evidence: `Status changed to Under Maintenance on ${asset.statusChangedAt.slice(0, 10)}.`,
    suggestedAction: "Escalate — an extended repair period often means the asset is nearing end of economic life.",
  };
}

function detectExpiry(dateField: string | null, todayIso: string, windowDays: number): { daysUntil: number; isPast: boolean } | null {
  if (!dateField) return null;
  const daysUntil = daysBetween(todayIso, dateField);
  if (daysUntil > windowDays) return null;
  return { daysUntil, isPast: daysUntil < 0 };
}

const EXPIRY_WINDOW_DAYS = 60;

export function detectWarrantyExpiry(asset: AssetSnapshot, todayIso: string, windowDays = EXPIRY_WINDOW_DAYS): AssetIntelligenceFinding | null {
  const expiry = detectExpiry(asset.warrantyExpiryDate, todayIso, windowDays);
  if (!expiry) return null;
  return {
    findingType: "WarrantyExpiry",
    confidence: expiry.isPast ? 0.9 : 0.7,
    reason: expiry.isPast
      ? `${asset.assetNumber} — ${asset.description}'s warranty expired ${Math.abs(expiry.daysUntil)} day(s) ago.`
      : `${asset.assetNumber} — ${asset.description}'s warranty expires in ${expiry.daysUntil} day(s).`,
    evidence: `Warranty expiry date: ${asset.warrantyExpiryDate}.`,
    suggestedAction: expiry.isPast ? "Confirm whether an extended warranty or maintenance contract is needed." : "Consider renewing or extending the warranty before it lapses.",
  };
}

export function detectInsuranceExpiry(asset: AssetSnapshot, todayIso: string, windowDays = EXPIRY_WINDOW_DAYS): AssetIntelligenceFinding | null {
  const expiry = detectExpiry(asset.insuranceExpiryDate, todayIso, windowDays);
  if (!expiry) return null;
  return {
    findingType: "InsuranceExpiry",
    confidence: expiry.isPast ? 0.95 : 0.75,
    reason: expiry.isPast
      ? `${asset.assetNumber} — ${asset.description}'s insurance expired ${Math.abs(expiry.daysUntil)} day(s) ago.`
      : `${asset.assetNumber} — ${asset.description}'s insurance expires in ${expiry.daysUntil} day(s).`,
    evidence: `Insurance expiry date: ${asset.insuranceExpiryDate}.`,
    suggestedAction: expiry.isPast ? "This asset may currently be uninsured — confirm and renew immediately." : "Renew cover before it lapses.",
  };
}

const UNUSUAL_DEPRECIATION_TOLERANCE_PERCENT = 5;

/** Unusual Depreciation — compares what was actually posted for an
 * asset's most recent period against what the SAME depreciation engine
 * would compute for it — a real consistency check (e.g. a manual
 * adjustment to a run line), not a second formula. */
export function detectUnusualDepreciation(asset: AssetSnapshot, actualAmount: number, expectedAmount: number): AssetIntelligenceFinding | null {
  if (expectedAmount <= 0) return null;
  const deviationPercent = round2((Math.abs(actualAmount - expectedAmount) / expectedAmount) * 100);
  if (deviationPercent < UNUSUAL_DEPRECIATION_TOLERANCE_PERCENT) return null;
  return {
    findingType: "UnusualDepreciation",
    confidence: Math.min(0.85, 0.4 + deviationPercent / 100),
    reason: `${asset.assetNumber} — ${asset.description}'s posted depreciation (${actualAmount}) deviates ${deviationPercent}% from the engine-computed expected amount (${expectedAmount}).`,
    evidence: `Depreciation method: ${asset.depreciationMethod}.`,
    suggestedAction: "Confirm whether a manual adjustment was intentional and properly authorized.",
  };
}

const IMPAIRMENT_MISSING_RUNS_THRESHOLD = 2;

/** Impairment Indicator — this platform has no market-valuation data
 * source (a real, disclosed gap); the closest genuinely computable
 * indicator is an asset that SHOULD be depreciating (Active, within its
 * useful life) but has posted zero depreciation across the last several
 * runs — missing depreciation is itself a real audit-relevant issue,
 * whether or not the underlying cause is impairment. */
export function detectImpairmentIndicator(asset: AssetSnapshot, todayIso: string, recentDepreciationAmounts: number[]): AssetIntelligenceFinding | null {
  if (asset.status !== "Active" || !asset.inServiceDate) return null;
  const netBookValue = computeNetBookValue(asset.cost, asset.accumulatedDepreciation, asset.accumulatedImpairment);
  if (netBookValue <= asset.residualValue) return null; // already fully depreciated — not an indicator
  if (recentDepreciationAmounts.length < IMPAIRMENT_MISSING_RUNS_THRESHOLD) return null;
  const allMissing = recentDepreciationAmounts.every((a) => a === 0);
  if (!allMissing) return null;

  return {
    findingType: "ImpairmentIndicator",
    confidence: 0.55,
    reason: `${asset.assetNumber} — ${asset.description} has posted no depreciation across the last ${recentDepreciationAmounts.length} run(s) despite being Active and within its useful life.`,
    evidence: `Net book value ${netBookValue}, residual value ${asset.residualValue}, in service since ${asset.inServiceDate}.`,
    suggestedAction: "Investigate why depreciation isn't running — either a real impairment indicator, or a missed Depreciation Run this asset should have been included in.",
  };
}

/** High Value Asset — a real classification against a caller-supplied
 * threshold (never hardcoded — see `asset-intelligence-service.ts`),
 * surfacing the platform's most material assets for extra scrutiny. */
export function detectHighValueAsset(asset: AssetSnapshot, threshold: number): AssetIntelligenceFinding | null {
  if (asset.cost < threshold) return null;
  return {
    findingType: "HighValueAsset",
    confidence: 0.9,
    reason: `${asset.assetNumber} — ${asset.description} cost ${asset.cost}, at or above the ${threshold} high-value threshold.`,
    evidence: `Cost: ${asset.cost}.`,
    suggestedAction: "Ensure this asset has adequate insurance cover and is included in the next physical verification.",
  };
}

/** Capitalisation Anomaly — an asset capitalised (posted to Fixed
 * Assets) below the typical capitalisation threshold, a real flag for
 * potential expense-vs-capitalise misclassification. */
export function detectCapitalisationAnomaly(asset: AssetSnapshot, threshold: number): AssetIntelligenceFinding | null {
  if (asset.status === "Draft" || asset.cost >= threshold) return null;
  return {
    findingType: "CapitalisationAnomaly",
    confidence: 0.5,
    reason: `${asset.assetNumber} — ${asset.description} was capitalised at ${asset.cost}, below the ${threshold} capitalisation threshold.`,
    evidence: `Cost: ${asset.cost}, status: ${asset.status}.`,
    suggestedAction: "Confirm this should have been capitalised rather than expensed directly.",
  };
}

export type AssetIntelligenceContext = {
  todayIso: string;
  highValueThreshold: number;
  capitalisationThreshold: number;
  warrantyWindowDays?: number;
  insuranceWindowDays?: number;
  actualLastDepreciationAmount?: number;
  expectedLastDepreciationAmount?: number;
  recentDepreciationAmounts?: number[];
};

/** Pure — runs every detector for one asset and returns whatever real
 * findings apply. The one orchestration point `asset-intelligence-service.ts`
 * calls per asset. */
export function buildAssetIntelligence(asset: AssetSnapshot, context: AssetIntelligenceContext): AssetIntelligenceFinding[] {
  const findings: (AssetIntelligenceFinding | null)[] = [
    detectOverdueReplacement(asset, context.todayIso),
    detectUnderutilisation(asset, context.todayIso),
    detectHighMaintenanceRisk(asset, context.todayIso),
    detectWarrantyExpiry(asset, context.todayIso, context.warrantyWindowDays),
    detectInsuranceExpiry(asset, context.todayIso, context.insuranceWindowDays),
    context.actualLastDepreciationAmount !== undefined && context.expectedLastDepreciationAmount !== undefined
      ? detectUnusualDepreciation(asset, context.actualLastDepreciationAmount, context.expectedLastDepreciationAmount)
      : null,
    detectImpairmentIndicator(asset, context.todayIso, context.recentDepreciationAmounts ?? []),
    detectIdleAsset(asset, context.todayIso),
    detectHighValueAsset(asset, context.highValueThreshold),
    detectCapitalisationAnomaly(asset, context.capitalisationThreshold),
  ];
  return findings.filter((f): f is AssetIntelligenceFinding => f !== null);
}
