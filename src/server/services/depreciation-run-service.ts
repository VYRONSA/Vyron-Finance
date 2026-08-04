/**
 * Application Service for Depreciation Runs — the one place a period's
 * depreciation is actually calculated (via `depreciation-engine.ts`,
 * never a second formula) and posted (via
 * `asset-lifecycle-engine.ts::buildDepreciationRunJournalLines`, through
 * the same shared `postApprovedJournals` Posting Engine).
 */

import * as assetRepo from "@/server/repositories/fixed-asset-repository";
import * as runRepo from "@/server/repositories/depreciation-run-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { runDepreciationForAsset } from "@/server/assets/depreciation-engine";
import { buildDepreciationRunJournalLines } from "@/server/assets/asset-lifecycle-engine";
import type { DepreciationRun } from "@/server/assets/types";

export class ValidationError extends Error {}

export const listDepreciationRuns = runRepo.listDepreciationRuns;
export const listDepreciationRunLines = runRepo.listDepreciationRunLines;
export const listDepreciationRunLinesForAsset = runRepo.listDepreciationRunLinesForAsset;

export type DepreciationRunResult = { run: DepreciationRun; assetsDepreciated: number; totalAmount: number };

export async function runDepreciation(companyId: string, periodStart: string, periodEnd: string, performedBy: string): Promise<DepreciationRunResult> {
  const assets = await assetRepo.listFixedAssets(companyId);

  const lines = assets
    .map((asset) => ({ asset, result: runDepreciationForAsset(asset, periodStart, periodEnd) }))
    .filter(({ result }) => result.amount > 0);

  const totalAmount = Math.round(lines.reduce((sum, l) => sum + l.result.amount, 0) * 100) / 100;
  const run = await runRepo.createDepreciationRun(companyId, { runDate: periodEnd, periodStart, periodEnd, createdBy: performedBy });

  if (totalAmount <= 0) {
    return { run, assetsDepreciated: 0, totalAmount: 0 };
  }

  const built = buildDepreciationRunJournalLines(totalAmount, `Depreciation run for ${periodStart} to ${periodEnd}`);
  if (!built.ok) throw new ValidationError(built.reason);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "Depreciation Run",
    description: `Depreciation run for ${periodStart} to ${periodEnd}`,
    reference: `DEP-${run.id}`,
    sourceType: "depreciation_run",
    sourceId: run.id,
    status: "Approved",
    lines: built.lines,
  });
  const outcome = await postApprovedJournals(companyId);
  if (!outcome.posted.some((p) => p.journalId === journal.id)) {
    throw new ValidationError("Depreciation run was approved but could not be posted (the Financial Period may be closed).");
  }

  await runRepo.createDepreciationRunLines(
    lines.map(({ asset, result }) => ({ runId: run.id, assetId: asset.id, depreciationAmount: result.amount, accumulatedDepreciationAfter: result.accumulatedDepreciationAfter, netBookValueAfter: result.netBookValueAfter })),
  );

  await Promise.all(lines.map(({ asset, result }) => assetRepo.updateFixedAsset(companyId, asset.id, { accumulated_depreciation: result.accumulatedDepreciationAfter })));

  const postedRun = await runRepo.markDepreciationRunPosted(companyId, run.id, totalAmount, journal.id);
  return { run: postedRun, assetsDepreciated: lines.length, totalAmount };
}
