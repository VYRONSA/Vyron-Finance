/**
 * Repository layer for Depreciation Runs — the required "audit history"
 * for every depreciation posting doubles as `depreciation_run_lines`,
 * queried directly rather than reconstructed. See
 * supabase/migrations/0018_fixed_assets_platform.sql.
 */

import { createClient } from "@/lib/supabase/server";
import { depreciationRunFromRow, depreciationRunLineFromRow, type DepreciationRunLineRow, type DepreciationRunRow } from "@/server/assets/mappers";
import type { DepreciationRun, DepreciationRunLine } from "@/server/assets/types";

export async function listDepreciationRuns(companyId: string): Promise<DepreciationRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("depreciation_runs").select("*").eq("company_id", companyId).order("run_date", { ascending: false }).returns<DepreciationRunRow[]>();
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

export async function markDepreciationRunPosted(companyId: string, runId: number, totalAmount: number, journalId: number): Promise<DepreciationRun> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("depreciation_runs")
    .update({ status: "Posted", total_amount: totalAmount, journal_id: journalId })
    .eq("company_id", companyId)
    .eq("id", runId)
    .select("*")
    .single<DepreciationRunRow>();
  if (error) throw error;
  return depreciationRunFromRow(data);
}

export type NewDepreciationRunLine = { runId: number; assetId: number; depreciationAmount: number; accumulatedDepreciationAfter: number; netBookValueAfter: number };

export async function createDepreciationRunLines(lines: NewDepreciationRunLine[]): Promise<void> {
  if (lines.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.from("depreciation_run_lines").insert(
    lines.map((l) => ({ run_id: l.runId, asset_id: l.assetId, depreciation_amount: l.depreciationAmount, accumulated_depreciation_after: l.accumulatedDepreciationAfter, net_book_value_after: l.netBookValueAfter })),
  );
  if (error) throw error;
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
