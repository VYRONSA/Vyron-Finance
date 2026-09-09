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
import { listAssetClasses } from "@/server/repositories/asset-class-repository";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { runDepreciationForAsset } from "@/server/assets/depreciation-engine";
import { buildDepreciationRunJournalLines, resolveAssetClassAccounts } from "@/server/assets/asset-lifecycle-engine";
import type { DepreciationRun } from "@/server/assets/types";

export class ValidationError extends Error {}

export const listDepreciationRuns = runRepo.listDepreciationRuns;
export const listDepreciationRunLines = runRepo.listDepreciationRunLines;
export const listDepreciationRunLinesForAsset = runRepo.listDepreciationRunLinesForAsset;

export type DepreciationRunResult = { run: DepreciationRun; assetsDepreciated: number; totalAmount: number };

// Master Implementation Tracker — Epic E1, Root Cause RC-2, Finding #195.
// The real-world trigger for double-depreciating a period is a run that
// looks "stuck" (its journal already posted, but nothing in the UI said
// so) getting re-run. Pure and exported so this check is directly
// unit-testable without a live database — the DB itself also now
// enforces the same rule (a partial unique index on Posted runs, see
// 0064_atomic_depreciation_run.sql) as a backstop against a race between
// two concurrent calls for the same period.
export function findPostedRunForPeriod(runs: DepreciationRun[], periodStart: string, periodEnd: string): DepreciationRun | null {
  return runs.find((r) => r.status === "Posted" && r.periodStart === periodStart && r.periodEnd === periodEnd) ?? null;
}

export async function runDepreciation(companyId: string, periodStart: string, periodEnd: string, performedBy: string): Promise<DepreciationRunResult> {
  const existingRuns = await runRepo.listDepreciationRuns(companyId);
  const alreadyPosted = findPostedRunForPeriod(existingRuns, periodStart, periodEnd);
  if (alreadyPosted) {
    throw new ValidationError(`Depreciation for ${periodStart} to ${periodEnd} was already posted (run #${alreadyPosted.id}, journal ${alreadyPosted.journalId ?? "—"}). Reverse that journal before re-running this period.`);
  }

  const [assets, assetClasses] = await Promise.all([assetRepo.listFixedAssets(companyId), listAssetClasses(companyId)]);
  const assetClassById = new Map(assetClasses.map((c) => [c.id, c]));

  const lines = assets
    .map((asset) => ({ asset, result: runDepreciationForAsset(asset, periodStart, periodEnd) }))
    .filter(({ result }) => result.amount > 0);

  const totalAmount = Math.round(lines.reduce((sum, l) => sum + l.result.amount, 0) * 100) / 100;
  const run = await runRepo.createDepreciationRun(companyId, { runDate: periodEnd, periodStart, periodEnd, createdBy: performedBy });

  if (totalAmount <= 0) {
    return { run, assetsDepreciated: 0, totalAmount: 0 };
  }

  // Finding #050 — grouped by each asset's own (possibly class-overridden)
  // accounts, not one hardcoded pair for the whole run.
  const amountsByClass = lines.map(({ asset, result }) => {
    const accounts = resolveAssetClassAccounts(asset.assetClassId !== null ? (assetClassById.get(asset.assetClassId) ?? null) : null);
    return { depreciationExpenseAccountCode: accounts.depreciationExpenseAccountCode, accumulatedDepreciationAccountCode: accounts.accumulatedDepreciationAccountCode, amount: result.amount };
  });

  const built = buildDepreciationRunJournalLines(amountsByClass, `Depreciation run for ${periodStart} to ${periodEnd}`);
  if (!built.ok) throw new ValidationError(built.reason);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "Depreciation Run",
    description: `Depreciation run for ${periodStart} to ${periodEnd}`,
    reference: `DEP-${run.id}`,
    sourceType: "depreciation_run",
    sourceId: run.id,
    status: "Approved",
    // Root Cause RC-1, Finding #184 — dated to the period being
    // depreciated, not whenever the run happened to be executed.
    journalDate: periodEnd,
    lines: built.lines,
  });
  const outcome = await postApprovedJournals(companyId);
  if (!outcome.posted.some((p) => p.journalId === journal.id)) {
    throw new ValidationError("Depreciation run was approved but could not be posted (the Financial Period may be closed).");
  }

  const postedRun = await runRepo.postDepreciationRunAtomic(
    companyId,
    run.id,
    journal.id,
    totalAmount,
    lines.map(({ asset, result }) => ({ runId: run.id, assetId: asset.id, depreciationAmount: result.amount, accumulatedDepreciationAfter: result.accumulatedDepreciationAfter, netBookValueAfter: result.netBookValueAfter })),
  );
  return { run: postedRun, assetsDepreciated: lines.length, totalAmount };
}
