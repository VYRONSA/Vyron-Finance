/**
 * Repository layer for Asset Findings. Every one of the 10 finding types
 * is asset-specific (never company-wide/null-related), so — unlike
 * `executive_alerts`/`audit_findings` — the plain unique constraint's
 * catch-and-reselect idempotency (mirroring
 * `vat-exception-repository.ts::raiseVatExceptionIdempotent`) is
 * sufficient; no NULL-distinctness edge case to special-case here.
 */

import { createClient } from "@/lib/supabase/server";
import { assetFindingFromRow, type AssetFindingRow } from "@/server/assets/mappers";
import type { AssetFinding, AssetFindingType } from "@/server/assets/types";

const UNIQUE_VIOLATION = "23505";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function listAssetFindings(companyId: string, filters: { assetId?: number; status?: AssetFinding["status"] } = {}): Promise<AssetFinding[]> {
  const supabase = await createClient();
  let query = supabase.from("asset_findings").select("*").eq("company_id", companyId);
  if (filters.assetId) query = query.eq("asset_id", filters.assetId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(LIST_CAP).returns<AssetFindingRow[]>();
  if (error) throw error;
  return data.map(assetFindingFromRow);
}

export type NewAssetFinding = { assetId: number; findingType: AssetFindingType; confidence: number; reason: string; evidence: string; suggestedAction: string };

export async function raiseAssetFindingIdempotent(companyId: string, input: NewAssetFinding): Promise<AssetFinding> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_findings")
    .insert({
      company_id: companyId,
      asset_id: input.assetId,
      finding_type: input.findingType,
      confidence: input.confidence,
      reason: input.reason,
      evidence: input.evidence,
      suggested_action: input.suggestedAction,
      status: "Open",
    })
    .select("*")
    .single<AssetFindingRow>();

  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      const { data: existing, error: selectError } = await supabase
        .from("asset_findings")
        .select("*")
        .eq("company_id", companyId)
        .eq("asset_id", input.assetId)
        .eq("finding_type", input.findingType)
        .eq("status", "Open")
        .single<AssetFindingRow>();
      if (selectError) throw selectError;
      return assetFindingFromRow(existing);
    }
    throw error;
  }
  return assetFindingFromRow(data);
}

export async function resolveAssetFinding(companyId: string, findingId: number, status: "Resolved" | "Dismissed", resolvedBy: string, note: string): Promise<AssetFinding> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_findings")
    .update({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_note: note })
    .eq("company_id", companyId)
    .eq("id", findingId)
    .select("*")
    .single<AssetFindingRow>();
  if (error) throw error;
  return assetFindingFromRow(data);
}
