/**
 * Service layer for Quotations. No accounting impact — validation only,
 * plus the status workflow (a quote never posts).
 */

import * as repo from "@/server/repositories/quotation-repository";
import { getCustomer, listCustomerContacts } from "@/server/repositories/customer-repository";
import { getCompany } from "@/server/services/company-service";
import { queueCommunication } from "@/server/services/communication-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
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

/** Finding #112 — resolves each line's optional `vatCode` against a real
 * VAT treatment (mirrors `sales-order-service.ts::computeOrderLines`),
 * rather than accepting an arbitrary rate. */
async function computeQuotationLines(companyId: string, lines: repo.NewQuotationLine[]) {
  const vatTreatments = await listVatTreatments(companyId);
  return lines.map((line) => {
    if (line.vatCode && !vatTreatments.some((t) => t.code === line.vatCode)) {
      throw new ValidationError(`Unknown VAT treatment "${line.vatCode}".`);
    }
    const rate = line.vatCode ? (vatTreatments.find((t) => t.code === line.vatCode)?.rate ?? 0) : 0;
    const vatAmount = Math.round(line.quantity * line.unitPrice * (rate / 100) * 100) / 100;
    return { ...line, vatAmount };
  });
}

export async function createQuotation(companyId: string, input: repo.NewQuotation): Promise<Quotation> {
  if (!input.customerId) throw new ValidationError("Customer is required.");
  if (!input.quotationDate) throw new ValidationError("Quotation date is required.");
  validateQuotationLines(input.lines);
  const lines = await computeQuotationLines(companyId, input.lines);
  return repo.createQuotation(companyId, { ...input, lines });
}

/** Finding #055 — mirrors `sales-order-service.ts::updateOrderLines`
 * exactly. Only a Draft quotation can be edited. */
export async function updateQuotationLines(companyId: string, quotationId: number, lines: repo.NewQuotationLine[]): Promise<Quotation> {
  const quotation = await repo.getQuotation(companyId, quotationId);
  if (!quotation) throw new NotFoundError(`No quotation with id ${quotationId}.`);
  if (quotation.status !== "Draft") {
    throw new ValidationError(`Only a Draft quotation can be edited (current status: ${quotation.status}).`);
  }
  validateQuotationLines(lines);
  const computedLines = await computeQuotationLines(companyId, lines);
  return repo.replaceQuotationLines(companyId, quotationId, computedLines);
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

/** Finding #166 — a Rejected quotation was a dead end with no action
 * available. Rather than reopen the terminal Rejected document itself
 * (its own transitions table stays `[]` on purpose — the rejection is a
 * real, permanent fact about that quotation), this creates a brand new
 * Draft quotation with the same customer and lines, letting the operator
 * revise and re-send without re-keying from scratch. */
export async function cloneQuotationAsDraft(companyId: string, quotationId: number): Promise<Quotation> {
  const quotation = await repo.getQuotation(companyId, quotationId);
  if (!quotation) throw new NotFoundError(`No quotation with id ${quotationId}.`);
  if (quotation.status !== "Rejected") {
    throw new ValidationError(`Only a Rejected quotation can be cloned (current status: ${quotation.status}).`);
  }
  return repo.createQuotation(companyId, {
    customerId: quotation.customerId,
    quotationDate: new Date().toISOString().slice(0, 10),
    expiryDate: quotation.expiryDate,
    notes: quotation.notes,
    lines: quotation.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
  });
}
