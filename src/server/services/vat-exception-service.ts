/**
 * Service layer for the VAT Exception Centre.
 */

import * as repo from "@/server/repositories/vat-exception-repository";
import type { VatException, VatExceptionStatus } from "@/server/vat/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listVatExceptions = (companyId: string, status?: VatExceptionStatus) => repo.listVatExceptions(companyId, status);

export async function resolveVatException(companyId: string, exceptionId: number, status: "Resolved" | "Dismissed", performedBy: string, note: string): Promise<VatException> {
  const existing = await repo.getVatException(companyId, exceptionId);
  if (!existing) throw new NotFoundError(`No VAT exception with id ${exceptionId}.`);
  if (existing.status !== "Open") throw new ValidationError(`Exception is already ${existing.status}.`);
  return repo.resolveVatException(companyId, exceptionId, status, performedBy, note);
}
