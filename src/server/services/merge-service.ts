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
