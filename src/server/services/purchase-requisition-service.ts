/**
 * Service layer for Purchase Requisitions. No accounting impact —
 * validation only, plus the status workflow. Mirrors
 * `quotation-service.ts` exactly.
 */

import * as repo from "@/server/repositories/purchase-requisition-repository";
import type { PurchaseRequisition, PurchaseRequisitionStatus } from "@/server/purchasing/types";
import { queueCommunication } from "@/server/services/communication-service";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const ALLOWED_TRANSITIONS: Record<PurchaseRequisitionStatus, PurchaseRequisitionStatus[]> = {
  Draft: ["Submitted"],
  Submitted: ["Approved", "Rejected"],
  Approved: ["Converted"],
  Rejected: [],
  Converted: [],
};

export function canTransitionRequisitionStatus(from: PurchaseRequisitionStatus, to: PurchaseRequisitionStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateRequisitionLines(lines: { description: string; quantity: number; estimatedUnitPrice: number }[]): void {
  if (lines.length === 0) throw new ValidationError("A requisition needs at least one line.");
  for (const line of lines) {
    if (!line.description?.trim()) throw new ValidationError("Every line needs a description.");
    if (line.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
    if (line.estimatedUnitPrice < 0) throw new ValidationError("Estimated unit price cannot be negative.");
  }
}

export const listPurchaseRequisitions = repo.listPurchaseRequisitions;
export const getPurchaseRequisition = repo.getPurchaseRequisition;

export async function createPurchaseRequisition(companyId: string, input: repo.NewPurchaseRequisition): Promise<PurchaseRequisition> {
  if (!input.requisitionDate) throw new ValidationError("Requisition date is required.");
  validateRequisitionLines(input.lines);
  return repo.createPurchaseRequisition(companyId, input);
}

async function transitionRequisition(companyId: string, requisitionId: number, to: PurchaseRequisitionStatus): Promise<PurchaseRequisition> {
  const requisition = await repo.getPurchaseRequisition(companyId, requisitionId);
  if (!requisition) throw new NotFoundError(`No purchase requisition with id ${requisitionId}.`);
  if (!canTransitionRequisitionStatus(requisition.status, to)) {
    throw new ValidationError(`Cannot move requisition ${requisition.requisitionNumber} from ${requisition.status} to ${to}.`);
  }
  return repo.setRequisitionStatus(companyId, requisitionId, to);
}

export async function submitRequisition(companyId: string, requisitionId: number): Promise<PurchaseRequisition> {
  const requisition = await transitionRequisition(companyId, requisitionId, "Submitted");

  try {
    const total = requisition.lines.reduce((sum, l) => sum + l.lineTotal, 0);
    await queueCommunication(companyId, {
      module: "Purchasing",
      businessObjectType: "PurchaseRequisition",
      businessObjectId: requisition.id,
      channel: "InApp",
      templateCode: "RequisitionNotification",
      recipients: [{ type: "User", name: "Approvers" }],
      variables: {
        requisitionNumber: requisition.requisitionNumber,
        requestedBy: requisition.requestedBy,
        total,
      },
    });
  } catch {
    // Communication failures must never break the primary operation.
  }

  return requisition;
}

export const approveRequisition = (companyId: string, requisitionId: number) => transitionRequisition(companyId, requisitionId, "Approved");
export const rejectRequisition = (companyId: string, requisitionId: number) => transitionRequisition(companyId, requisitionId, "Rejected");
