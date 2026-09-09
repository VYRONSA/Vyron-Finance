/**
 * Application Service for merges — "Merge Merchants" (Merchant Matching
 * tab) and merging duplicate Customer/Supplier master records (Duplicate
 * Detection tab). Every merge re-points real references before removing
 * the losing record, and records a real, queryable history row — never a
 * silent delete.
 */

import * as merchantRepo from "@/server/repositories/merchant-repository";
import * as mergeRepo from "@/server/repositories/merge-repository";
import { recordOverride } from "@/server/repositories/matching-override-repository";
import { getCustomer } from "@/server/services/customer-service";
import { getSupplier } from "@/server/services/supplier-management-service";
import type { MerchantMerge, PartyMerge } from "@/server/matching/types";
import type { SupplierMergeRepointCounts } from "@/server/repositories/merge-repository";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listMerchantMerges = mergeRepo.listMerchantMerges;
export const listPartyMerges = mergeRepo.listPartyMerges;

export async function mergeMerchants(companyId: string, survivingMerchantId: number, mergedMerchantId: number, performedBy = "System"): Promise<MerchantMerge> {
  if (survivingMerchantId === mergedMerchantId) throw new ValidationError("Cannot merge a merchant into itself.");

  const [surviving, merged] = await Promise.all([merchantRepo.getMerchant(companyId, survivingMerchantId), merchantRepo.getMerchant(companyId, mergedMerchantId)]);
  if (!surviving) throw new NotFoundError(`No merchant with id ${survivingMerchantId}.`);
  if (!merged) throw new NotFoundError(`No merchant with id ${mergedMerchantId}.`);

  // Fold the merged merchant's own name + aliases into the survivor's
  // alias list, so a future beneficiary matching either name still
  // resolves correctly.
  const mergedAliases = [...new Set([...surviving.aliases, merged.name, ...merged.aliases])];
  await merchantRepo.updateMerchant(companyId, survivingMerchantId, { aliases: mergedAliases });

  const repointed = await merchantRepo.repointTransactionsToMerchant(companyId, mergedMerchantId, survivingMerchantId);
  await merchantRepo.deleteMerchant(companyId, mergedMerchantId);

  const record = await mergeRepo.recordMerchantMerge(companyId, survivingMerchantId, mergedMerchantId, merged.name, repointed, performedBy);
  await recordOverride(companyId, {
    itemType: "merchant",
    itemId: survivingMerchantId,
    fieldName: "merge",
    oldValue: `${merged.name} (#${mergedMerchantId})`,
    newValue: `${surviving.name} (#${survivingMerchantId})`,
    reason: `Merged ${merged.name} into ${surviving.name} — ${repointed} transaction(s) repointed.`,
    performedBy,
  });
  return record;
}

export type SupplierMergeResult = {
  survivingSupplierId: number;
  survivingSupplierName: string;
  survivingSupplierCode: string;
  mergedSupplierId: number;
  mergedSupplierName: string;
  mergedSupplierCode: string;
  recordsRepointed: SupplierMergeRepointCounts;
  totalRecordsRepointed: number;
  duplicateStatus: "Inactive";
};

export type SupplierMergeCandidate = {
  id: number;
  name: string;
  supplierCode: string;
  status: "Active" | "Inactive";
  vatNumber: string;
  taxNumber: string;
  paymentTermsDays: number;
  linkedRecordCount: number;
};

/** Phase 33A — the read-only data the merge dialog needs to show BOTH
 * candidates side by side before the user picks a survivor: every field
 * the dialog displays, plus a live "how many records would move"
 * figure. Never mutates anything. */
export async function getSupplierMergePreview(companyId: string, supplierAId: number, supplierBId: number): Promise<{ supplierA: SupplierMergeCandidate; supplierB: SupplierMergeCandidate }> {
  if (supplierAId === supplierBId) throw new ValidationError("Cannot compare a supplier with itself.");

  const [a, b] = await Promise.all([getSupplier(companyId, supplierAId), getSupplier(companyId, supplierBId)]);
  if (!a) throw new NotFoundError(`No supplier with id ${supplierAId}.`);
  if (!b) throw new NotFoundError(`No supplier with id ${supplierBId}.`);

  const [linkedA, linkedB] = await Promise.all([mergeRepo.getSupplierLinkedRecordCount(companyId, supplierAId), mergeRepo.getSupplierLinkedRecordCount(companyId, supplierBId)]);

  const toCandidate = (s: NonNullable<typeof a>, linkedRecordCount: number): SupplierMergeCandidate => ({
    id: s.id,
    name: s.name,
    supplierCode: s.supplierCode,
    status: s.status,
    vatNumber: s.vatNumber,
    taxNumber: s.taxNumber,
    paymentTermsDays: s.paymentTermsDays,
    linkedRecordCount,
  });

  return { supplierA: toCandidate(a, linkedA), supplierB: toCandidate(b, linkedB) };
}

/** Phase 33 — the real, atomic Supplier merge. Unlike `recordPartyMerge`
 * below (which only logs the decision for Customer/Supplier alike), this
 * actually repoints every real foreign key onto the duplicate supplier
 * and deactivates it, all inside one Postgres transaction
 * (`fn_merge_supplier`, migration 0090) — see that migration's own
 * docstring for the complete list of repointed tables and why atomicity
 * requires a stored function rather than sequential JS-side calls.
 *
 * Phase 33A — now called from a real, explicit-choice UI
 * (`supplier-merge-dialog.tsx`, via `POST /api/companies/[companyId]/suppliers/merge`).
 * `survivingSupplierId`/`duplicateSupplierId` are always the ids the user
 * deliberately picked there — this function itself never guesses. Both
 * suppliers must currently be Active; merging into or out of an already-
 * inactive record isn't a case the UI supports, so it's rejected here
 * rather than silently allowed. */
export async function mergeSuppliers(companyId: string, survivingSupplierId: number, duplicateSupplierId: number, performedBy = "System"): Promise<SupplierMergeResult> {
  if (survivingSupplierId === duplicateSupplierId) throw new ValidationError("Cannot merge a supplier into itself.");

  const [surviving, duplicate] = await Promise.all([getSupplier(companyId, survivingSupplierId), getSupplier(companyId, duplicateSupplierId)]);
  if (!surviving) throw new NotFoundError(`No supplier with id ${survivingSupplierId}.`);
  if (!duplicate) throw new NotFoundError(`No supplier with id ${duplicateSupplierId}.`);
  if (surviving.status !== "Active") throw new ValidationError(`Supplier "${surviving.name}" is not Active — only Active suppliers can be merged.`);
  if (duplicate.status !== "Active") throw new ValidationError(`Supplier "${duplicate.name}" is not Active — only Active suppliers can be merged.`);

  const { duplicateName, ...recordsRepointed } = await mergeRepo.mergeSupplierAtomic(companyId, survivingSupplierId, duplicateSupplierId, performedBy);

  const totalRecordsRepointed = Object.values(recordsRepointed).reduce((sum, n) => sum + n, 0);
  await recordOverride(companyId, {
    itemType: "supplier",
    itemId: survivingSupplierId,
    fieldName: "merge",
    oldValue: `${duplicateName} (#${duplicateSupplierId})`,
    newValue: `${surviving.name} (#${survivingSupplierId})`,
    reason: `Merged ${duplicateName} into ${surviving.name} — ${totalRecordsRepointed} record(s) repointed, duplicate deactivated.`,
    performedBy,
  });

  return {
    survivingSupplierId,
    survivingSupplierName: surviving.name,
    survivingSupplierCode: surviving.supplierCode,
    mergedSupplierId: duplicateSupplierId,
    mergedSupplierName: duplicateName,
    mergedSupplierCode: duplicate.supplierCode,
    recordsRepointed,
    totalRecordsRepointed,
    duplicateStatus: "Inactive",
  };
}

/** Customer/Supplier merges don't delete the losing master record (real
 * financial history — invoices/bills/receipts/payments — points at it,
 * and this platform never fabricates a mass-repoint of every one of
 * those tables). This records the merge decision and lets a human
 * complete the data migration deliberately, rather than silently
 * cascading into every financial table. */
export async function recordPartyMerge(companyId: string, partyType: "Customer" | "Supplier", survivingPartyId: number, mergedPartyId: number, performedBy = "System"): Promise<PartyMerge> {
  if (survivingPartyId === mergedPartyId) throw new ValidationError("Cannot merge a record into itself.");

  const mergedParty = partyType === "Customer" ? await getCustomer(companyId, mergedPartyId) : await getSupplier(companyId, mergedPartyId);
  if (!mergedParty) throw new NotFoundError(`No ${partyType.toLowerCase()} with id ${mergedPartyId}.`);

  const record = await mergeRepo.recordPartyMerge(companyId, partyType, survivingPartyId, mergedPartyId, mergedParty.name, performedBy);
  await recordOverride(companyId, {
    itemType: partyType.toLowerCase(),
    itemId: survivingPartyId,
    fieldName: "merge",
    oldValue: `${mergedParty.name} (#${mergedPartyId})`,
    newValue: `#${survivingPartyId}`,
    reason: `Flagged ${mergedParty.name} as a duplicate of the surviving ${partyType.toLowerCase()} — financial history requires manual review before re-pointing.`,
    performedBy,
  });
  return record;
}
