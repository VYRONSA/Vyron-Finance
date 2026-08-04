/**
 * Service layer for Quotations. No accounting impact — validation only,
 * plus the status workflow (a quote never posts).
 */

import * as repo from "@/server/repositories/quotation-repository";
import { getCustomer, listCustomerContacts } from "@/server/repositories/customer-repository";
import { getCompany } from "@/server/services/company-service";
import { queueCommunication } from "@/server/services/communication-service";
import type { Quotation, QuotationStatus } from "@/server/sales/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const ALLOWED_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  Draft: ["Sent", "Rejected"],
  Sent: ["Accepted", "Rejected", "Expired"],
  Accepted: ["Converted"],
  Rejected: [],
  Expired: [],
  Converted: [],
};

export function canTransitionQuotationStatus(from: QuotationStatus, to: QuotationStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateQuotationLines(lines: { description: string; quantity: number; unitPrice: number }[]): void {
  if (lines.length === 0) throw new ValidationError("A quotation needs at least one line.");
  for (const line of lines) {
    if (!line.description?.trim()) throw new ValidationError("Every line needs a description.");
    if (line.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
    if (line.unitPrice < 0) throw new ValidationError("Unit price cannot be negative.");
  }
}

export const listQuotations = repo.listQuotations;
export const getQuotation = repo.getQuotation;

export async function createQuotation(companyId: string, input: repo.NewQuotation): Promise<Quotation> {
  if (!input.customerId) throw new ValidationError("Customer is required.");
  if (!input.quotationDate) throw new ValidationError("Quotation date is required.");
  validateQuotationLines(input.lines);
  return repo.createQuotation(companyId, input);
}

async function transitionQuotation(companyId: string, quotationId: number, to: QuotationStatus): Promise<Quotation> {
  const quotation = await repo.getQuotation(companyId, quotationId);
  if (!quotation) throw new NotFoundError(`No quotation with id ${quotationId}.`);
  if (!canTransitionQuotationStatus(quotation.status, to)) {
    throw new ValidationError(`Cannot move quotation ${quotation.quotationNumber} from ${quotation.status} to ${to}.`);
  }
  return repo.setQuotationStatus(companyId, quotationId, to);
}

/** Marking a quotation as Sent IS the customer-facing "send" event, so —
 * unlike every other Sales document, which only ever emails on an
 * explicit manual button click — this is the one place an automatic,
 * fire-and-forget communication is correct. Queued only after the status
 * transition has already succeeded, and never allowed to affect this
 * function's own return value. */
export async function sendQuotation(companyId: string, quotationId: number): Promise<Quotation> {
  const quotation = await transitionQuotation(companyId, quotationId, "Sent");

  try {
    const customer = await getCustomer(companyId, quotation.customerId);
    const contacts = await listCustomerContacts(quotation.customerId);
    const contact = contacts.find((c) => c.isPrimary) ?? contacts[0];
    const company = await getCompany(companyId);
    const total = quotation.lines.reduce((sum, l) => sum + l.lineTotal, 0);

    await queueCommunication(companyId, {
      module: "Sales",
      businessObjectType: "Quotation",
      businessObjectId: quotation.id,
      channel: "Email",
      templateCode: "QuotationEmail",
      recipients: [{ type: "Customer", id: quotation.customerId, name: customer?.name ?? `Customer #${quotation.customerId}`, address: contact?.email || null }],
      variables: {
        customerName: customer?.name ?? `Customer #${quotation.customerId}`,
        quotationNumber: quotation.quotationNumber,
        total: total.toFixed(2),
        expiryDate: quotation.expiryDate ?? "",
        companyName: company?.name ?? "",
      },
      createdBy: "System",
    });
  } catch {
    // Communication failures must never break the primary operation.
  }

  return quotation;
}
export const acceptQuotation = (companyId: string, quotationId: number) => transitionQuotation(companyId, quotationId, "Accepted");
export const rejectQuotation = (companyId: string, quotationId: number) => transitionQuotation(companyId, quotationId, "Rejected");
export const expireQuotation = (companyId: string, quotationId: number) => transitionQuotation(companyId, quotationId, "Expired");
