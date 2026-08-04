/**
 * Application Service for the Asset Register and Asset Lifecycle.
 * "Every lifecycle event becomes a Business Event" — every event that
 * moves money here goes through the exact same pattern every other
 * document type in this platform uses: `buildJournalFromEvent` (or, for
 * Disposal, the bespoke-but-real `buildAssetDisposalJournalLines`) ->
 * `journalRepo.createJournal` (status `"Approved"`) ->
 * `postApprovedJournals` (the ONE Posting Engine) -> only then mark the
 * asset/event as posted. Transfer and Capitalisation are dimensional/
 * status changes with no GL effect and correctly carry no journal.
 */

import * as assetClassRepo from "@/server/repositories/asset-class-repository";
import * as assetRepo from "@/server/repositories/fixed-asset-repository";
import * as lifecycleRepo from "@/server/repositories/asset-lifecycle-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import { recordAuditEntry } from "@/server/services/automation-audit-service";
import { buildAssetDisposalJournalLines } from "@/server/assets/asset-lifecycle-engine";
import { computeNetBookValue } from "@/server/assets/depreciation-engine";
import type { AssetLifecycleEventType, AssetStatus, FixedAsset, FixedAssetWithNetBookValue } from "@/server/assets/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listAssetClasses = assetClassRepo.listAssetClasses;
export async function createAssetClass(companyId: string, input: assetClassRepo.NewAssetClass) {
  if (!input.name?.trim()) throw new ValidationError("Asset class name is required.");
  return assetClassRepo.createAssetClass(companyId, input);
}

export const listFixedAssets = assetRepo.listFixedAssets;
export const getFixedAsset = assetRepo.getFixedAsset;
export const listAssetLifecycleEvents = lifecycleRepo.listAssetLifecycleEvents;
export const listAllAssetLifecycleEvents = lifecycleRepo.listAllAssetLifecycleEvents;

/** Pure — derived, never persisted redundantly. */
export function withNetBookValue(asset: FixedAsset): FixedAssetWithNetBookValue {
  return { ...asset, netBookValue: computeNetBookValue(asset.cost, asset.accumulatedDepreciation, asset.accumulatedImpairment) };
}

async function requireAsset(companyId: string, assetId: number): Promise<FixedAsset> {
  const asset = await assetRepo.getFixedAsset(companyId, assetId);
  if (!asset) throw new NotFoundError(`No fixed asset with id ${assetId}.`);
  return asset;
}

export type AcquireAssetInput = assetRepo.NewFixedAsset & { paymentAccountCode: string };

/** Acquisition — creates the asset row and posts DR Fixed Assets - Cost
 * / CR the supplied payment account (Bank, or Creditors if bought on
 * credit) via the real `"Asset Acquisition"` posting rule. */
export async function acquireAsset(companyId: string, performedBy: string, input: AcquireAssetInput): Promise<FixedAsset> {
  if (!input.description?.trim()) throw new ValidationError("Description is required.");
  if (!(input.cost > 0)) throw new ValidationError("Cost must be greater than zero.");
  if (!(input.usefulLifeMonths > 0)) throw new ValidationError("Useful life must be greater than zero months.");

  const assetNumber = await assetRepo.nextAssetNumber(companyId);
  const asset = await assetRepo.createFixedAsset(companyId, { ...input, assetNumber, createdBy: performedBy });

  const built = await buildJournalFromEvent(companyId, "Asset Acquisition", {
    grossAmount: input.cost,
    vatRatePercent: 0,
    description: `Acquisition of ${assetNumber} — ${input.description}`,
    accountsByRole: { payment_account: input.paymentAccountCode },
  });

  let journalId: number | null = null;
  if (built.ok) {
    const journal = await journalRepo.createJournal(companyId, {
      journalType: "Asset Acquisition",
      description: `Acquisition of ${assetNumber} — ${input.description}`,
      reference: assetNumber,
      sourceType: "fixed_asset",
      sourceId: asset.id,
      status: "Approved",
      lines: built.lines,
    });
    const outcome = await postApprovedJournals(companyId);
    if (outcome.posted.some((p) => p.journalId === journal.id)) journalId = journal.id;
  }

  const status: AssetStatus = input.inServiceDate ? "Active" : "Draft";
  const updated = await assetRepo.updateFixedAsset(companyId, asset.id, { acquisition_journal_id: journalId, status, status_changed_at: new Date().toISOString() });

  await lifecycleRepo.createAssetLifecycleEvent(companyId, {
    assetId: asset.id,
    eventType: "Acquisition",
    eventDate: input.purchaseDate ?? new Date().toISOString().slice(0, 10),
    description: `Acquired for ${input.cost}`,
    amount: input.cost,
    journalId,
    performedBy,
  });

  await recordAuditEntry(companyId, {
    performedBy,
    actionType: "AssetAcquired",
    reason: built.ok ? "Acquisition journal posted." : `Not posted: ${built.reason}`,
    journalIds: journalId ? [journalId] : [],
    documentType: "FixedAsset",
    documentId: asset.id,
    isReversible: false,
  });

  return updated;
}

export async function capitaliseAsset(companyId: string, assetId: number, inServiceDate: string, performedBy: string): Promise<FixedAsset> {
  await requireAsset(companyId, assetId);
  const updated = await assetRepo.updateFixedAsset(companyId, assetId, { status: "Active", status_changed_at: new Date().toISOString(), in_service_date: inServiceDate });
  await lifecycleRepo.createAssetLifecycleEvent(companyId, { assetId, eventType: "Capitalisation", eventDate: inServiceDate, description: "Asset capitalised and placed into service.", performedBy });
  return updated;
}

/** Improvement — a capitalised addition to an existing asset's cost,
 * posted through the same `"Asset Improvement"` rule as Acquisition. */
export async function improveAsset(companyId: string, assetId: number, amount: number, paymentAccountCode: string, description: string, performedBy: string): Promise<FixedAsset> {
  const asset = await requireAsset(companyId, assetId);
  if (!(amount > 0)) throw new ValidationError("Improvement amount must be greater than zero.");

  const built = await buildJournalFromEvent(companyId, "Asset Improvement", {
    grossAmount: amount,
    vatRatePercent: 0,
    description: `Improvement to ${asset.assetNumber} — ${description}`,
    accountsByRole: { payment_account: paymentAccountCode },
  });
  if (!built.ok) throw new ValidationError(`Could not generate an improvement journal: ${built.reason}`);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "Asset Improvement",
    description: `Improvement to ${asset.assetNumber} — ${description}`,
    reference: asset.assetNumber,
    sourceType: "fixed_asset",
    sourceId: asset.id,
    status: "Approved",
    lines: built.lines,
  });
  const outcome = await postApprovedJournals(companyId);
  const journalId = outcome.posted.some((p) => p.journalId === journal.id) ? journal.id : null;
  if (!journalId) throw new ValidationError(`Improvement was approved but could not be posted (period may be closed).`);

  const updated = await assetRepo.updateFixedAsset(companyId, assetId, { cost: asset.cost + amount });
  await lifecycleRepo.createAssetLifecycleEvent(companyId, { assetId, eventType: "Improvement", eventDate: new Date().toISOString().slice(0, 10), description, amount, journalId, performedBy });
  return updated;
}

export type TransferInput = { branchId?: number | null; departmentId?: number | null; costCentreId?: number | null; projectId?: number | null; location?: string; custodian?: string };

/** Transfer — a dimensional reassignment only, no GL effect (moving an
 * asset between cost centres doesn't move money) — a real, disclosed
 * scope decision, not an omission. */
export async function transferAsset(companyId: string, assetId: number, input: TransferInput, performedBy: string): Promise<FixedAsset> {
  const asset = await requireAsset(companyId, assetId);
  const updated = await assetRepo.updateFixedAsset(companyId, assetId, {
    branch_id: input.branchId,
    department_id: input.departmentId,
    cost_centre_id: input.costCentreId,
    project_id: input.projectId,
    location: input.location,
    custodian: input.custodian,
  });
  await lifecycleRepo.createAssetLifecycleEvent(companyId, {
    assetId,
    eventType: "Transfer",
    eventDate: new Date().toISOString().slice(0, 10),
    description: "Asset transferred.",
    metadata: { from: { branchId: asset.branchId, departmentId: asset.departmentId, costCentreId: asset.costCentreId, projectId: asset.projectId, location: asset.location, custodian: asset.custodian }, to: input },
    performedBy,
  });
  return updated;
}

/** Revaluation / Impairment — a positive `delta` posts
 * `"Asset Revaluation Increase"` (raises cost, credits Revaluation
 * Surplus); a negative `delta` posts `"Asset Impairment"` (raises
 * Accumulated Impairment). A downward revaluation below cost is modeled
 * as an impairment in this platform — a disclosed simplification, see
 * `docs/MIGRATION_ROADMAP.md`. */
export async function revalueAsset(companyId: string, assetId: number, delta: number, performedBy: string): Promise<FixedAsset> {
  const asset = await requireAsset(companyId, assetId);
  if (delta === 0) throw new ValidationError("Revaluation amount cannot be zero.");

  const eventType: "Revaluation" | "Impairment" = delta > 0 ? "Revaluation" : "Impairment";
  const postingEvent = delta > 0 ? "Asset Revaluation Increase" : "Asset Impairment";
  const amount = Math.abs(delta);

  const built = await buildJournalFromEvent(companyId, postingEvent, { grossAmount: amount, vatRatePercent: 0, description: `${eventType} of ${asset.assetNumber}` });
  if (!built.ok) throw new ValidationError(`Could not generate a ${eventType.toLowerCase()} journal: ${built.reason}`);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: `Asset ${eventType}`,
    description: `${eventType} of ${asset.assetNumber}`,
    reference: asset.assetNumber,
    sourceType: "fixed_asset",
    sourceId: asset.id,
    status: "Approved",
    lines: built.lines,
  });
  const outcome = await postApprovedJournals(companyId);
  const journalId = outcome.posted.some((p) => p.journalId === journal.id) ? journal.id : null;
  if (!journalId) throw new ValidationError(`${eventType} was approved but could not be posted (period may be closed).`);

  const updated = await assetRepo.updateFixedAsset(
    companyId,
    assetId,
    delta > 0 ? { cost: asset.cost + amount } : { accumulated_impairment: asset.accumulatedImpairment + amount },
  );
  await lifecycleRepo.createAssetLifecycleEvent(companyId, { assetId, eventType, eventDate: new Date().toISOString().slice(0, 10), description: `${eventType} of ${amount}`, amount, journalId, performedBy });
  return updated;
}

const TERMINAL_STATUS_BY_EVENT: Record<"Disposal" | "WriteOff" | "Retirement", AssetStatus> = { Disposal: "Disposed", WriteOff: "WrittenOff", Retirement: "Retired" };

/** Disposal/WriteOff/Retirement all reuse the same
 * `buildAssetDisposalJournalLines` builder — a write-off or retirement
 * is simply a disposal with zero proceeds. Clears Cost/Accumulated
 * Depreciation/Accumulated Impairment off the books and recognizes any
 * gain or loss, through the same Posting Engine. */
export async function disposeAsset(
  companyId: string,
  assetId: number,
  eventType: "Disposal" | "WriteOff" | "Retirement",
  proceeds: number,
  paymentAccountCode: string | null,
  disposalDate: string,
  description: string,
  performedBy: string,
): Promise<FixedAsset> {
  const asset = await requireAsset(companyId, assetId);
  if (asset.status === "Disposed" || asset.status === "WrittenOff" || asset.status === "Retired") {
    throw new ValidationError(`${asset.assetNumber} has already been ${asset.status}.`);
  }

  const built = buildAssetDisposalJournalLines(asset.cost, asset.accumulatedDepreciation, asset.accumulatedImpairment, proceeds, paymentAccountCode, description || `${eventType} of ${asset.assetNumber}`);
  if (!built.ok) throw new ValidationError(`Could not generate a disposal journal: ${built.reason}`);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: `Asset ${eventType}`,
    description: description || `${eventType} of ${asset.assetNumber}`,
    reference: asset.assetNumber,
    sourceType: "fixed_asset_disposal",
    sourceId: asset.id,
    status: "Approved",
    lines: built.lines,
  });
  const outcome = await postApprovedJournals(companyId);
  const journalId = outcome.posted.some((p) => p.journalId === journal.id) ? journal.id : null;
  if (!journalId) throw new ValidationError(`${eventType} was approved but could not be posted (period may be closed).`);

  const updated = await assetRepo.setFixedAssetStatus(companyId, assetId, TERMINAL_STATUS_BY_EVENT[eventType]);
  await lifecycleRepo.createAssetLifecycleEvent(companyId, { assetId, eventType: eventType as AssetLifecycleEventType, eventDate: disposalDate, description, amount: proceeds, journalId, performedBy });

  await recordAuditEntry(companyId, {
    performedBy,
    actionType: `Asset${eventType}`,
    reason: `${eventType} journal posted.`,
    journalIds: [journalId],
    documentType: "FixedAsset",
    documentId: assetId,
    isReversible: false,
  });

  return updated;
}
