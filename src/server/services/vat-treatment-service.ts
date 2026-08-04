import * as repo from "@/server/repositories/vat-treatment-repository";
import * as rateHistoryRepo from "@/server/repositories/vat-rate-history-repository";
import { VAT_TYPES, type VatTreatment, type VatType } from "@/server/company-management/types";

export class ValidationError extends Error {}

export function validateVatTreatmentInput(input: { code: string; rate: number; vatType?: string }) {
  if (!input.code?.trim()) throw new ValidationError("Code is required.");
  if (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100) {
    throw new ValidationError("Rate must be a number between 0 and 100.");
  }
  if (input.vatType !== undefined && !VAT_TYPES.includes(input.vatType as VatType)) {
    throw new ValidationError(`Invalid VAT type "${input.vatType}" — expected one of ${VAT_TYPES.join(", ")}.`);
  }
}

export const listVatTreatments = repo.listVatTreatments;
export const getVatTreatment = repo.getVatTreatment;
export const listRateHistory = rateHistoryRepo.listRateHistory;

export async function createVatTreatment(companyId: string, input: repo.NewVatTreatment): Promise<VatTreatment> {
  validateVatTreatmentInput(input);
  if (!input.name?.trim()) throw new ValidationError("Name is required.");
  return repo.createVatTreatment(companyId, { code: input.code.trim(), name: input.name.trim(), rate: input.rate, vatType: input.vatType });
}

export type EditVatTreatmentRequest = Partial<{ name: string; rate: number; vatType: VatType; isActive: boolean }>;

/** A `rate` change is real, effective-dated history from today
 * (`vat-rate-history-repository.ts::changeRate`) — never a silent
 * overwrite of what every past calculation used. `name`/`vatType`/
 * `isActive` are plain column updates. */
export async function updateVatTreatment(companyId: string, vatTreatmentId: number, input: EditVatTreatmentRequest, performedBy = "System"): Promise<VatTreatment> {
  if (input.rate !== undefined && (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100)) {
    throw new ValidationError("Rate must be a number between 0 and 100.");
  }
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError("Name cannot be empty.");
  if (input.vatType !== undefined && !VAT_TYPES.includes(input.vatType)) {
    throw new ValidationError(`Invalid VAT type "${input.vatType}" — expected one of ${VAT_TYPES.join(", ")}.`);
  }

  if (input.rate !== undefined) {
    await rateHistoryRepo.changeRate(vatTreatmentId, input.rate, new Date().toISOString().slice(0, 10), performedBy);
  }

  const remainingFields = {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.vatType !== undefined && { vat_type: input.vatType }),
    ...(input.isActive !== undefined && { is_active: input.isActive }),
  };
  if (Object.keys(remainingFields).length > 0) {
    return repo.updateVatTreatment(companyId, vatTreatmentId, remainingFields);
  }

  const updated = await repo.getVatTreatment(companyId, vatTreatmentId);
  if (!updated) throw new ValidationError(`No VAT treatment with id ${vatTreatmentId}.`);
  return updated;
}
