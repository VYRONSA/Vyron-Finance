/**
 * Service layer for Merchants — validation on top of the repository.
 */

import * as repo from "@/server/repositories/merchant-repository";
import type { Merchant } from "@/server/banking-rules/types";

export class ValidationError extends Error {}

export const listMerchants = repo.listMerchants;
export const getMerchant = repo.getMerchant;

export async function createMerchant(companyId: string, input: repo.NewMerchant): Promise<Merchant> {
  if (!input.name?.trim()) throw new ValidationError("Merchant name is required.");
  return repo.createMerchant(companyId, { ...input, name: input.name.trim() });
}

export async function updateMerchant(companyId: string, merchantId: number, fields: repo.UpdatableMerchantFields): Promise<Merchant> {
  if (fields.name !== undefined && !fields.name.trim()) throw new ValidationError("Merchant name is required.");
  return repo.updateMerchant(companyId, merchantId, fields);
}
