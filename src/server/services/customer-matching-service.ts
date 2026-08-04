/**
 * Customer Matching workspace's application service — Invoices, Credit
 * Notes, Debit Notes, Receipts, Statement, and Auto/Manual/AI-Suggested
 * Allocation, all composed from the EXISTING Sales services. No
 * duplicate posting/allocation logic: every allocation, auto or manual,
 * still goes through `customer-receipt-service.ts::allocateReceipt` —
 * the one real allocation path Sales already built and tested.
 */

import { listCustomerReceipts } from "@/server/services/customer-receipt-service";
import { allocateReceipt } from "@/server/services/customer-receipt-service";
import { listSalesInvoices } from "@/server/services/sales-invoice-service";
import { findAllocationCandidates, type AllocationMatchCandidate } from "@/server/matching/receipt-allocation-matching-engine";
import { buildCustomerStatement, type StatementEntry } from "@/server/matching/customer-statement-engine";
import { recordOverride } from "@/server/repositories/matching-override-repository";
import type { CustomerReceipt, SalesInvoice } from "@/server/sales/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type CustomerMatchingWorkspaceData = {
  invoices: SalesInvoice[];
  creditNotes: SalesInvoice[];
  debitNotes: SalesInvoice[];
  receipts: CustomerReceipt[];
  candidates: AllocationMatchCandidate[];
};

export async function getCustomerMatchingWorkspace(companyId: string): Promise<CustomerMatchingWorkspaceData> {
  const [allInvoices, receipts] = await Promise.all([listSalesInvoices(companyId), listCustomerReceipts(companyId)]);
  return {
    invoices: allInvoices.filter((i) => i.documentType === "Invoice"),
    creditNotes: allInvoices.filter((i) => i.documentType === "Credit Note"),
    debitNotes: allInvoices.filter((i) => i.documentType === "Debit Note"),
    receipts,
    candidates: findAllocationCandidates(receipts, allInvoices),
  };
}

export async function getCustomerStatement(companyId: string, customerId: number): Promise<StatementEntry[]> {
  const [invoices, receipts] = await Promise.all([listSalesInvoices(companyId), listCustomerReceipts(companyId)]);
  return buildCustomerStatement(
    invoices.filter((i) => i.customerId === customerId),
    receipts.filter((r) => r.customerId === customerId),
  );
}

/** Manual Matching — the user picks any (receipt, invoice, amount) pair
 * regardless of what the engine suggested; delegates straight to the
 * existing, already-tested `allocateReceipt` (same validation, same
 * audit trail — a manual allocation is not a second code path). */
export async function manualAllocate(companyId: string, receiptId: number, invoiceId: number, amount: number, performedBy: string): Promise<void> {
  await allocateReceipt(companyId, receiptId, invoiceId, amount);
  await recordOverride(companyId, {
    itemType: "CustomerReceiptAllocation",
    itemId: receiptId,
    fieldName: "invoiceId",
    oldValue: null,
    newValue: String(invoiceId),
    reason: `Manual allocation of ${amount} to invoice ${invoiceId}`,
    performedBy,
  });
}

export type AutoAllocateOutcome = { allocated: number; totalAmount: number; failures: string[] };

/** Auto Matching — executes every "Matched"-band candidate (in
 * descending confidence order), greedily consuming each receipt's
 * remaining balance and each invoice's outstanding balance as it goes so
 * one receipt/invoice can never be double-counted within a single run.
 * Still calls the real `allocateReceipt` for every allocation — auto and
 * manual matching are the same action, just a different trigger. */
export async function autoAllocateCustomerMatches(companyId: string, performedBy: string): Promise<AutoAllocateOutcome> {
  const [invoices, receipts] = await Promise.all([listSalesInvoices(companyId), listCustomerReceipts(companyId)]);
  const candidates = findAllocationCandidates(receipts, invoices).filter((c) => c.band === "Matched");

  const remainingByReceipt = new Map<number, number>();
  const outstandingByInvoice = new Map<number, number>();
  for (const r of receipts) remainingByReceipt.set(r.id, r.amount - r.allocations.reduce((sum, a) => sum + a.amountAllocated, 0));
  for (const i of invoices) outstandingByInvoice.set(i.id, i.outstanding);

  let allocated = 0;
  let totalAmount = 0;
  const failures: string[] = [];

  for (const candidate of candidates) {
    const remaining = round2(remainingByReceipt.get(candidate.receiptId) ?? 0);
    const outstanding = round2(outstandingByInvoice.get(candidate.invoiceId) ?? 0);
    const amount = round2(Math.min(remaining, outstanding));
    if (amount <= 0.01) continue;

    try {
      await allocateReceipt(companyId, candidate.receiptId, candidate.invoiceId, amount);
      await recordOverride(companyId, {
        itemType: "CustomerReceiptAllocation",
        itemId: candidate.receiptId,
        fieldName: "invoiceId",
        oldValue: null,
        newValue: String(candidate.invoiceId),
        reason: `Auto-allocated at ${candidate.score}% confidence`,
        performedBy,
      });
      remainingByReceipt.set(candidate.receiptId, round2(remaining - amount));
      outstandingByInvoice.set(candidate.invoiceId, round2(outstanding - amount));
      allocated += 1;
      totalAmount = round2(totalAmount + amount);
    } catch (err) {
      failures.push(`Receipt ${candidate.receiptId} -> Invoice ${candidate.invoiceId}: ${err instanceof Error ? err.message : "failed to allocate."}`);
    }
  }

  return { allocated, totalAmount, failures };
}
