/**
 * Service layer for the Banking Exceptions workspace.
 */

import * as repo from "@/server/repositories/banking-exception-repository";
import type { BankingException, ExceptionStatus } from "@/server/banking-rules/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listBankingExceptions = (companyId: string, status?: ExceptionStatus) => repo.listBankingExceptions(companyId, status);

export async function resolveException(companyId: string, exceptionId: number, status: "Resolved" | "Dismissed", performedBy: string, note: string): Promise<BankingException> {
  const existing = await repo.getBankingException(companyId, exceptionId);
  if (!existing) throw new NotFoundError(`No exception with id ${exceptionId}.`);
  if (existing.status !== "Open") throw new ValidationError(`Exception is already ${existing.status}.`);
  return repo.resolveException(companyId, exceptionId, status, performedBy, note);
}
