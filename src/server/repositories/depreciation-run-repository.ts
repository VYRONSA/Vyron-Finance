/**
 * Repository layer for Depreciation Runs — the required "audit history"
 * for every depreciation posting doubles as `depreciation_run_lines`,
 * queried directly rather than reconstructed. See
 * supabase/migrations/0018_fixed_assets_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { depreciationRunFromRow, depreciationRunLineFromRow, type DepreciationRunLineRow, type DepreciationRunRow } from "@/server/assets/mappers";
import type { DepreciationRun, DepreciationRunLine } from "@/server/assets/types";

// Finding #016 (RC-6) — the one query this repository had with no cap
// at all; the sibling Dashboard query that feeds off this list was
// already fixed for the identical defect class elsewhere.
const LIST_CAP = 10_000;

export async function listDepreciationRuns(companyId: string): Promise<DepreciationRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("depreciation_runs").select("*").eq("company_id", companyId).order("run_date", { ascending: false }).limit(LIST_CAP).returns<DepreciationRunRow[]>();
  if (error) throw error;
  return data.map(depreciationRunFromRow);
}

export async function getDepreciationRun(companyId: string, runId: number): Promise<DepreciationRun | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("depreciation_runs").select("*").eq("company_id", companyId).eq("id", runId).maybeSingle<DepreciationRunRow>();
  if (error) throw error;
  return data ? depreciationRunFromRow(data) : null;
}

export type NewDepreciationRun = { runDate: string; periodStart: string; periodEnd: string; createdBy?: string };

export async function createDepreciationRun(companyId: string, input: NewDepreciationRun): Promise<DepreciationRun> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("depreciation_runs")
    .insert({ company_id: companyId, run_date: input.runDate, period_start: input.periodStart, period_end: input.periodEnd, created_by: input.createdBy ?? "System" })
    .select("*")
    .single<DepreciationRunRow>();
  if (error) throw error;
  return depreciationRunFromRow(data);
}

export type NewDepreciationRunLine = { runId: number; assetId: number; depreciationAmount: number; accumulatedDepreciationAfter: number; netBookValueAfter: number };

// Master Implementation Tracker — Epic E1, Root Cause RC-2, Finding #195.
// `markDepreciationRunPosted`/`createDepreciationRunLines` used to be two
// separate calls after the journal itself was already posted — a
// failure between them could leave a real GL journal posted with no
// matching run lines, or some assets' `accumulated_depreciation` updated
// and others not, while the run itself still read as not-yet-posted.
// `fn_post_depreciation_run` (0064_atomic_depreciation_run.sql) makes the
// run-lines/asset-update/mark-posted sequence one atomic statement.
export async function postDepreciationRunAtomic(companyId: string, runId: number, journalId: number, totalAmount: number, lines: NewDepreciationRunLine[]): Promise<DepreciationRun> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_post_depreciation_run", {
    p_company_id: companyId,
    p_run_id: runId,
    p_journal_id: journalId,
    p_total_amount: totalAmount,
    p_lines: lines.map((l) => ({
      assetId: l.assetId,
      depreciationAmount: l.depreciationAmount,
      accumulatedDepreciationAfter: l.accumulatedDepreciationAfter,
      netBookValueAfter: l.netBookValueAfter,
    })),
  });
  if (error) throw error;
  const run = await getDepreciationRun(companyId, runId);
  if (!run) throw new Error(`No depreciation run with id ${runId}`);
  return run;
}

export async function listDepreciationRunLines(runId: number): Promise<DepreciationRunLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("depreciation_run_lines").select("*").eq("run_id", runId).returns<DepreciationRunLineRow[]>();
  if (error) throw error;
  return data.map(depreciationRunLineFromRow);
}

export async function listDepreciationRunLinesForAsset(companyId: string, assetId: number, limit = 12): Promise<DepreciationRunLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("depreciation_run_lines")
    .select("*, depreciation_runs!inner(company_id, run_date)")
    .eq("asset_id", assetId)
    .eq("depreciation_runs.company_id", companyId)
    .order("id", { ascending: false })
    .limit(limit)
    .returns<DepreciationRunLineRow[]>();
  if (error) throw error;
  return data.map(depreciationRunLineFromRow);
}
