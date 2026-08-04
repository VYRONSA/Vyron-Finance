/**
 * Service layer for the unified Inventory Transaction ledger — the real
 * integration point the Inventory Platform exists for. Every accounting-
 * relevant movement resolves a seeded Posting Rule ('Goods Received',
 * 'Inventory Issue', 'Inventory Return', 'Inventory Adjustment Increase'/
 * 'Decrease' — seeded in 0012_inventory_platform.sql) into a real
 * journal, exactly mirroring `sales-invoice-service.ts`'s
 * approveAndPostInvoice pattern, including the same Retry Posting
 * recovery path.
 *
 * Transfers and Opening Balances never post — same "no accounting
 * impact" precedent Sales Orders/Deliveries/GRNs already established
 * (see the migration's own header comment) — they're created and
 * immediately marked Posted with no journal.
 *
 * Movements TRIGGERED automatically by another document (a Goods
 * Received Note, a Sales Invoice's stock lines, a restocking Credit
 * Note) are created AND approved-and-posted in the same server-side
 * call via `createAndAutoPost` — "automatic" from the end user's
 * perspective, while still leaving a real Draft-momentary audit trail.
 * A movement a user creates directly in the Inventory workspace (a
 * manual Receipt, Adjustment, or Write-off) goes through the same
 * Draft->Submitted->Approved->Posted workflow Bills already use, since
 * these are user-initiated financial corrections that deserve a real
 * review step — not auto-posted.
 */

import * as repo from "@/server/repositories/inventory-transaction-repository";
import * as itemRepo from "@/server/repositories/stock-item-repository";
import * as layerRepo from "@/server/repositories/stock-cost-layer-repository";
import * as journalRepo from "@/server/repositories/journal-repository";
import { consumeFifoLayers, computeWeightedAverageCost } from "@/server/inventory/costing";
import { buildJournalFromEvent } from "@/server/services/posting-rule-service";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import type { InventoryTransaction, InventoryTransactionStatus, InventoryTransactionType } from "@/server/inventory/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Types that never post — created and immediately Posted, no journal. */
const NON_POSTING_TYPES: InventoryTransactionType[] = ["Transfer", "OpeningBalance"];

const EVENT_TYPE_BY_TYPE: Partial<Record<InventoryTransactionType, string>> = {
  Receipt: "Goods Received",
  Issue: "Inventory Issue",
  Return: "Inventory Return",
};

export function validateTransactionLines(lines: { stockItemId: number; quantity: number }[]): void {
  if (lines.length === 0) throw new ValidationError("A transaction needs at least one line.");
  for (const line of lines) {
    if (!line.stockItemId) throw new ValidationError("Every line needs a stock item.");
    if (line.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
  }
}

export const listInventoryTransactions = repo.listInventoryTransactions;
export const listInventoryTransactionsByItem = repo.listInventoryTransactionsByItem;
export const getInventoryTransaction = repo.getInventoryTransaction;

async function requireStockItem(companyId: string, stockItemId: number) {
  const item = await itemRepo.getStockItem(companyId, stockItemId);
  if (!item) throw new NotFoundError(`No stock item with id ${stockItemId}.`);
  return item;
}

/** Receipt-like: adds a new FIFO layer and rolls the item's average cost
 * forward. Used by Receipts, Returns, Adjustment Increases, Opening
 * Balances, and a Transfer's destination side. */
async function receiveIntoLayer(companyId: string, stockItemId: number, warehouseId: number, date: string, quantity: number, unitCost: number): Promise<void> {
  const item = await requireStockItem(companyId, stockItemId);
  await layerRepo.createCostLayer(companyId, stockItemId, warehouseId, date, quantity, unitCost);
  const newAverageCost = computeWeightedAverageCost(item.quantityOnHand, item.averageCost, quantity, unitCost);
  await itemRepo.setStockLevels(companyId, stockItemId, round2(item.quantityOnHand + quantity), newAverageCost);
}

/** Issue-like: consumes the oldest FIFO layers first. Throws if the
 * warehouse doesn't have enough stock — never allows a silent negative.
 * Returns the real consumed cost, for the resulting journal's amount.
 * Used by Issues, Adjustment Decreases, Write-offs, and a Transfer's
 * source side. */
async function issueFromLayers(companyId: string, stockItemId: number, warehouseId: number, quantity: number): Promise<number> {
  const item = await requireStockItem(companyId, stockItemId);
  const layers = await layerRepo.listCostLayers(companyId, stockItemId, warehouseId);
  const result = consumeFifoLayers(layers, quantity);
  if (result.shortfall > 0) {
    throw new ValidationError(`Not enough stock of ${item.stockCode} in this warehouse to cover ${quantity} — short by ${result.shortfall}.`);
  }
  await layerRepo.applyLayerUpdates(companyId, result.layerUpdates);
  await itemRepo.setStockLevels(companyId, stockItemId, round2(item.quantityOnHand - quantity), item.averageCost);
  return result.consumedCost;
}

async function applyLinesAndGetAmount(companyId: string, transaction: InventoryTransaction): Promise<number> {
  let total = 0;
  switch (transaction.transactionType) {
    case "Receipt":
    case "Return":
    case "OpeningBalance":
      for (const line of transaction.lines) {
        await receiveIntoLayer(companyId, line.stockItemId, transaction.warehouseId, transaction.transactionDate, line.quantity, line.unitCost);
        total = round2(total + line.quantity * line.unitCost);
      }
      return total;
    case "Issue":
    case "WriteOff":
      for (const line of transaction.lines) {
        total = round2(total + (await issueFromLayers(companyId, line.stockItemId, transaction.warehouseId, line.quantity)));
      }
      return total;
    case "Adjustment":
      for (const line of transaction.lines) {
        if (transaction.direction === "Decrease") {
          total = round2(total + (await issueFromLayers(companyId, line.stockItemId, transaction.warehouseId, line.quantity)));
        } else {
          await receiveIntoLayer(companyId, line.stockItemId, transaction.warehouseId, transaction.transactionDate, line.quantity, line.unitCost);
          total = round2(total + line.quantity * line.unitCost);
        }
      }
      return total;
    case "Transfer":
      for (const line of transaction.lines) {
        const consumedCost = await issueFromLayers(companyId, line.stockItemId, transaction.warehouseId, line.quantity);
        const blendedUnitCost = line.quantity > 0 ? round2(consumedCost / line.quantity) : 0;
        await receiveIntoLayer(companyId, line.stockItemId, transaction.destinationWarehouseId!, transaction.transactionDate, line.quantity, blendedUnitCost);
      }
      return 0;
    default:
      return 0;
  }
}

export type NewInventoryTransactionInput = Omit<repo.NewInventoryTransaction, "transactionType">;

async function createTransaction(companyId: string, transactionType: InventoryTransactionType, input: NewInventoryTransactionInput): Promise<InventoryTransaction> {
  if (!input.warehouseId) throw new ValidationError("Warehouse is required.");
  if (!input.transactionDate) throw new ValidationError("Transaction date is required.");
  if (transactionType === "Transfer" && !input.destinationWarehouseId) throw new ValidationError("A transfer needs a destination warehouse.");
  if (transactionType === "Adjustment" && !input.direction) throw new ValidationError("An adjustment needs a direction (Increase or Decrease).");
  validateTransactionLines(input.lines);

  const transaction = await repo.createInventoryTransaction(companyId, { ...input, transactionType });

  if (NON_POSTING_TYPES.includes(transactionType)) {
    await applyLinesAndGetAmount(companyId, transaction);
    return repo.setTransactionStatus(companyId, transaction.id, "Posted");
  }

  return transaction;
}

export const receiveStock = (companyId: string, input: NewInventoryTransactionInput) => createTransaction(companyId, "Receipt", input);
export const issueStock = (companyId: string, input: NewInventoryTransactionInput) => createTransaction(companyId, "Issue", input);
export const transferStock = (companyId: string, input: NewInventoryTransactionInput) => createTransaction(companyId, "Transfer", input);
export const returnStock = (companyId: string, input: NewInventoryTransactionInput) => createTransaction(companyId, "Return", input);
export const writeOffStock = (companyId: string, input: NewInventoryTransactionInput) => createTransaction(companyId, "WriteOff", input);
export const recordOpeningBalance = (companyId: string, input: NewInventoryTransactionInput) => createTransaction(companyId, "OpeningBalance", input);

export function adjustStock(companyId: string, direction: "Increase" | "Decrease", input: NewInventoryTransactionInput): Promise<InventoryTransaction> {
  return createTransaction(companyId, "Adjustment", { ...input, direction });
}

const ALLOWED_TRANSITIONS: Record<InventoryTransactionStatus, InventoryTransactionStatus[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Approved", "Cancelled"],
  Approved: [],
  Posted: [],
  Cancelled: [],
};

export function canTransitionTransactionStatus(from: InventoryTransactionStatus, to: InventoryTransactionStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

async function requireTransaction(companyId: string, transactionId: number): Promise<InventoryTransaction> {
  const transaction = await repo.getInventoryTransaction(companyId, transactionId);
  if (!transaction) throw new NotFoundError(`No inventory transaction with id ${transactionId}.`);
  return transaction;
}

export async function submitTransaction(companyId: string, transactionId: number): Promise<InventoryTransaction> {
  const transaction = await requireTransaction(companyId, transactionId);
  if (!canTransitionTransactionStatus(transaction.status, "Submitted")) {
    throw new ValidationError(`Cannot submit ${transaction.transactionNumber} from status ${transaction.status}.`);
  }
  return repo.setTransactionStatus(companyId, transactionId, "Submitted");
}

export async function cancelTransaction(companyId: string, transactionId: number): Promise<InventoryTransaction> {
  const transaction = await requireTransaction(companyId, transactionId);
  if (!canTransitionTransactionStatus(transaction.status, "Cancelled")) {
    throw new ValidationError(`Cannot cancel ${transaction.transactionNumber} from status ${transaction.status}.`);
  }
  return repo.cancelTransaction(companyId, transactionId);
}

function resolveEventType(transaction: InventoryTransaction): string {
  if (transaction.transactionType === "Adjustment") {
    return transaction.direction === "Decrease" ? "Inventory Adjustment Decrease" : "Inventory Adjustment Increase";
  }
  if (transaction.transactionType === "WriteOff") return "Inventory Adjustment Decrease";
  const eventType = EVENT_TYPE_BY_TYPE[transaction.transactionType];
  if (!eventType) throw new ValidationError(`${transaction.transactionType} transactions do not post.`);
  return eventType;
}

/** Approve AND post in one call, same "automatic" pattern as
 * `sales-invoice-service.ts::approveAndPostInvoice` — applies the real
 * stock movement (FIFO consumption / new cost layer) THEN posts the
 * journal, so a failed post never leaves stock quietly moved with
 * nothing to show for it in the GL. */
export async function approveAndPostTransaction(companyId: string, transactionId: number): Promise<InventoryTransaction> {
  const transaction = await requireTransaction(companyId, transactionId);
  if (!canTransitionTransactionStatus(transaction.status, "Approved")) {
    throw new ValidationError(`Cannot approve ${transaction.transactionNumber} from status ${transaction.status}.`);
  }

  const eventType = resolveEventType(transaction);
  const amount = await applyLinesAndGetAmount(companyId, transaction);

  const built = await buildJournalFromEvent(companyId, eventType, {
    grossAmount: amount,
    vatRatePercent: 0,
    description: `${transaction.transactionType} ${transaction.transactionNumber}`,
  });
  if (!built.ok) {
    throw new ValidationError(`Could not generate a journal for ${transaction.transactionNumber}: ${built.reason}`);
  }

  const journal = await journalRepo.createJournal(companyId, {
    journalType: transaction.transactionType,
    description: `${transaction.transactionType} ${transaction.transactionNumber}${transaction.reference ? ` — ${transaction.reference}` : ""}`,
    reference: transaction.reference || transaction.transactionNumber,
    sourceType: "inventory_transaction",
    sourceId: transaction.id,
    status: "Approved",
    lines: built.lines,
  });

  await repo.approveTransaction(companyId, transactionId, journal.id);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(
      `${transaction.transactionNumber} was approved but could not be posted${skip ? `: ${skip.reason}` : "."} It remains Approved.`,
    );
  }

  return repo.markTransactionPosted(companyId, transactionId);
}

/** Recovery path for the one real gap `approveAndPostTransaction` can
 * leave behind — mirrors `sales-invoice-service.ts::retryPostInvoice`.
 * The stock movement itself already happened at Approve time, so retry
 * only needs to re-run the Posting Engine, never re-touches inventory. */
export async function retryPostTransaction(companyId: string, transactionId: number): Promise<InventoryTransaction> {
  const transaction = await requireTransaction(companyId, transactionId);
  if (transaction.status !== "Approved") {
    throw new ValidationError(`Only an Approved-but-unposted transaction can retry posting (current status: ${transaction.status}).`);
  }
  if (transaction.journalId === null) throw new ValidationError(`${transaction.transactionNumber} has no linked journal to post.`);

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === transaction.journalId);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === transaction.journalId);
    throw new ValidationError(`${transaction.transactionNumber} still could not be posted${skip ? `: ${skip.reason}` : "."}`);
  }

  return repo.markTransactionPosted(companyId, transactionId);
}

/** Workflow Completion Audit fix — reverses the stock a cancelled Goods
 * Received Note added, and posts the real reversing journal via the
 * 'Goods Received Reversal' rule (the exact inverse of 'Goods Received':
 * DR GRNI Clearing / CR Inventory). Consumes the reversed quantity back
 * out through the SAME FIFO-layer mechanism a real Issue uses
 * (`issueFromLayers`) — so if some of the received stock has already
 * left the warehouse (issued/sold since), this throws the same honest
 * "not enough stock" error rather than silently allowing the GRN to be
 * cancelled out from under stock that's already gone. */
export async function reverseGoodsReceipt(
  companyId: string,
  warehouseId: number,
  lines: { stockItemId: number; quantity: number }[],
  reference: string,
  sourceType: string,
  sourceId: number,
): Promise<void> {
  let total = 0;
  for (const line of lines) {
    total = round2(total + (await issueFromLayers(companyId, line.stockItemId, warehouseId, line.quantity)));
  }

  const built = await buildJournalFromEvent(companyId, "Goods Received Reversal", {
    grossAmount: total,
    vatRatePercent: 0,
    description: `Reversal of goods receipt — ${reference}`,
  });
  if (!built.ok) throw new ValidationError(`Could not generate a reversal journal for ${reference}: ${built.reason}`);

  const journal = await journalRepo.createJournal(companyId, {
    journalType: "Goods Received Reversal",
    description: `Reversal of goods receipt — ${reference}`,
    reference,
    sourceType,
    sourceId,
    status: "Approved",
    lines: built.lines,
  });

  const outcome = await postApprovedJournals(companyId);
  const wasPosted = outcome.posted.some((p) => p.journalId === journal.id);
  if (!wasPosted) {
    const skip = outcome.skipped.find((s) => s.journalId === journal.id);
    throw new ValidationError(`Reversal for ${reference} was approved but could not be posted${skip ? `: ${skip.reason}` : "."}`);
  }
}

/** Create AND approve-and-post in one call — used by the automatic
 * Sales/Purchasing integration hooks so stock genuinely moves the
 * instant a GRN/Invoice/Credit Note is approved, with no separate
 * manual step, while still leaving the same real Draft-momentary audit
 * trail a manually-created transaction would have. */
export async function createAndAutoPost(
  companyId: string,
  transactionType: "Receipt" | "Issue" | "Return" | "Adjustment",
  input: NewInventoryTransactionInput,
): Promise<InventoryTransaction> {
  const transaction = await createTransaction(companyId, transactionType, input);
  await repo.setTransactionStatus(companyId, transaction.id, "Submitted");
  return approveAndPostTransaction(companyId, transaction.id);
}
