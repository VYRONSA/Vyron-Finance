/**
 * Repository layer for the unified Inventory Transaction ledger
 * (Receipt/Issue/Transfer/Adjustment/StockTake/Return/WriteOff/
 * OpeningBalance via `transaction_type`, mirroring the
 * `ae_imported_bills`/`sales_invoices` "one document, one discriminator"
 * shape). Only the accounting-relevant types ever carry a `journal_id`;
 * see `inventory-transaction-service.ts` for which.
 */

import { createClient } from "@/lib/supabase/server";
import { getPerformedByLabel } from "@/server/auth/require-session";
import { inventoryTransactionFromRow, type InventoryTransactionRow } from "@/server/inventory/mappers";
import type { InventoryTransaction, InventoryTransactionStatus, InventoryTransactionType } from "@/server/inventory/types";

const TRANSACTION_SELECT = "*, inventory_transaction_lines(*)";
const PREFIX_BY_TYPE: Record<InventoryTransactionType, string> = {
  Receipt: "REC",
  Issue: "ISS",
  Transfer: "TRF",
  Adjustment: "ADJ",
  StockTake: "STK",
  Return: "RET",
  WriteOff: "WOF",
  OpeningBalance: "OPN",
};

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the full rationale; same safety bound applied here.
const LIST_CAP = 10_000;

export async function nextTransactionNumber(companyId: string, type: InventoryTransactionType): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("inventory_transactions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("transaction_type", type);
  if (error) throw error;
  return `${PREFIX_BY_TYPE[type]}${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listInventoryTransactions(companyId: string, type?: InventoryTransactionType): Promise<InventoryTransaction[]> {
  const supabase = await createClient();
  let query = supabase.from("inventory_transactions").select(TRANSACTION_SELECT).eq("company_id", companyId);
  if (type) query = query.eq("transaction_type", type);
  const { data, error } = await query.order("transaction_date", { ascending: false }).limit(LIST_CAP).returns<InventoryTransactionRow[]>();
  if (error) throw error;
  return data.map(inventoryTransactionFromRow);
}

export async function listInventoryTransactionsByItem(companyId: string, stockItemId: number): Promise<InventoryTransaction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_transactions")
    .select("*, inventory_transaction_lines!inner(*)")
    .eq("company_id", companyId)
    .eq("inventory_transaction_lines.stock_item_id", stockItemId)
    .order("transaction_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<InventoryTransactionRow[]>();
  if (error) throw error;
  return data.map(inventoryTransactionFromRow);
}

export async function getInventoryTransaction(companyId: string, transactionId: number): Promise<InventoryTransaction | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_transactions")
    .select(TRANSACTION_SELECT)
    .eq("company_id", companyId)
    .eq("id", transactionId)
    .maybeSingle<InventoryTransactionRow>();
  if (error) throw error;
  return data ? inventoryTransactionFromRow(data) : null;
}

export type NewInventoryTransactionLine = {
  stockItemId: number;
  quantity: number;
  unitCost?: number;
  serialNumber?: string;
  lotNumber?: string;
  expiryDate?: string | null;
  notes?: string;
};
export type NewInventoryTransaction = {
  transactionNumber?: string;
  transactionType: InventoryTransactionType;
  transactionDate: string;
  warehouseId: number;
  destinationWarehouseId?: number | null;
  reference?: string;
  notes?: string;
  sourceType?: string;
  sourceId?: number | null;
  direction?: "Increase" | "Decrease" | null;
  lines: NewInventoryTransactionLine[];
};

export async function createInventoryTransaction(companyId: string, input: NewInventoryTransaction): Promise<InventoryTransaction> {
  const supabase = await createClient();
  const transactionNumber = input.transactionNumber ?? (await nextTransactionNumber(companyId, input.transactionType));

  const { data: headerRow, error: headerError } = await supabase
    .from("inventory_transactions")
    .insert({
      company_id: companyId,
      transaction_type: input.transactionType,
      transaction_number: transactionNumber,
      transaction_date: input.transactionDate,
      warehouse_id: input.warehouseId,
      destination_warehouse_id: input.destinationWarehouseId ?? null,
      reference: input.reference ?? "",
      notes: input.notes ?? "",
      source_type: input.sourceType ?? "",
      source_id: input.sourceId ?? null,
      direction: input.direction ?? null,
    })
    .select("*")
    .single<InventoryTransactionRow>();
  if (headerError) throw headerError;

  const { data: lineRows, error: linesError } = await supabase
    .from("inventory_transaction_lines")
    .insert(
      input.lines.map((line, index) => ({
        transaction_id: headerRow.id,
        line_order: index,
        stock_item_id: line.stockItemId,
        quantity: line.quantity,
        unit_cost: line.unitCost ?? 0,
        serial_number: line.serialNumber ?? "",
        lot_number: line.lotNumber ?? "",
        expiry_date: line.expiryDate ?? null,
        notes: line.notes ?? "",
      })),
    )
    .select("*");
  if (linesError) throw linesError;

  return inventoryTransactionFromRow({ ...headerRow, inventory_transaction_lines: lineRows });
}

async function setTransactionFields(companyId: string, transactionId: number, fields: Record<string, unknown>): Promise<InventoryTransaction> {
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_transactions").update(fields).eq("company_id", companyId).eq("id", transactionId);
  if (error) throw error;
  const transaction = await getInventoryTransaction(companyId, transactionId);
  if (!transaction) throw new Error(`No inventory transaction with id ${transactionId}`);
  return transaction;
}

export async function setTransactionStatus(companyId: string, transactionId: number, status: InventoryTransactionStatus): Promise<InventoryTransaction> {
  return setTransactionFields(companyId, transactionId, { status });
}

export async function approveTransaction(companyId: string, transactionId: number, journalId: number | null): Promise<InventoryTransaction> {
  const performedBy = await getPerformedByLabel();
  return setTransactionFields(companyId, transactionId, { status: "Approved", approved_by: performedBy, approved_at: new Date().toISOString(), journal_id: journalId });
}

export async function markTransactionPosted(companyId: string, transactionId: number): Promise<InventoryTransaction> {
  return setTransactionFields(companyId, transactionId, { status: "Posted", posted_at: new Date().toISOString() });
}

export async function cancelTransaction(companyId: string, transactionId: number): Promise<InventoryTransaction> {
  const performedBy = await getPerformedByLabel();
  return setTransactionFields(companyId, transactionId, { status: "Cancelled", cancelled_by: performedBy, cancelled_at: new Date().toISOString() });
}
