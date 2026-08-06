/**
 * Repository layer for Purchase Orders — no accounting impact. Tracks
 * `received_quantity`/`billed_quantity` per line so Partial Receipts and
 * "has this line been fully billed yet" are both real, queryable facts —
 * mirrors `sales-order-repository.ts` exactly.
 */

import { createClient } from "@/lib/supabase/server";
import { purchaseOrderFromRow, type PurchaseOrderRow } from "@/server/purchasing/mappers";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/server/purchasing/types";

const ORDER_SELECT = "*, purchase_order_lines(*)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function nextOrderNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `PO${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listPurchaseOrders(companyId: string): Promise<PurchaseOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(ORDER_SELECT)
    .eq("company_id", companyId)
    .order("order_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<PurchaseOrderRow[]>();
  if (error) throw error;
  return data.map(purchaseOrderFromRow);
}

export async function listPurchaseOrdersBySupplier(companyId: string, supplierId: number): Promise<PurchaseOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(ORDER_SELECT)
    .eq("company_id", companyId)
    .eq("supplier_id", supplierId)
    .order("order_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<PurchaseOrderRow[]>();
  if (error) throw error;
  return data.map(purchaseOrderFromRow);
}

export async function getPurchaseOrder(companyId: string, orderId: number): Promise<PurchaseOrder | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(ORDER_SELECT)
    .eq("company_id", companyId)
    .eq("id", orderId)
    .maybeSingle<PurchaseOrderRow>();
  if (error) throw error;
  return data ? purchaseOrderFromRow(data) : null;
}

export type NewPurchaseOrderLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  stockItemId?: number | null;
  // Product Review Board — multi-line capture parity with Bills. All
  // optional: a caller that doesn't supply them (e.g. Requisition ->
  // Order conversion) gets exactly today's behaviour — see
  // 0060_purchase_order_line_dimensions.sql.
  glAccount?: string | null;
  vatCode?: string | null;
  costCentreId?: number | null;
  projectId?: number | null;
  departmentId?: number | null;
  discount?: number;
  netAmount?: number;
  vatAmount?: number;
};
export type NewPurchaseOrder = {
  orderNumber?: string;
  supplierId: number;
  requisitionId?: number | null;
  orderDate: string;
  notes?: string;
  lines: NewPurchaseOrderLine[];
};

export async function createPurchaseOrder(companyId: string, input: NewPurchaseOrder): Promise<PurchaseOrder> {
  const supabase = await createClient();
  const orderNumber = input.orderNumber ?? (await nextOrderNumber(companyId));

  const { data: orderRow, error: orderError } = await supabase
    .from("purchase_orders")
    .insert({
      company_id: companyId,
      supplier_id: input.supplierId,
      requisition_id: input.requisitionId ?? null,
      order_number: orderNumber,
      order_date: input.orderDate,
      notes: input.notes ?? "",
    })
    .select("*")
    .single<PurchaseOrderRow>();
  if (orderError) throw orderError;

  const { data: lineRows, error: linesError } = await supabase
    .from("purchase_order_lines")
    .insert(
      input.lines.map((line, index) => {
        const discount = line.discount ?? 0;
        // Falls back to exactly today's arithmetic (no VAT concept)
        // when a caller doesn't supply netAmount/vatAmount — see
        // NewPurchaseOrderLine's own comment.
        const netAmount = line.netAmount ?? Math.round((line.quantity * line.unitPrice - discount) * 100) / 100;
        const vatAmount = line.vatAmount ?? 0;
        return {
          order_id: orderRow.id,
          line_order: index,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: Math.round((netAmount + vatAmount) * 100) / 100,
          stock_item_id: line.stockItemId ?? null,
          gl_account: line.glAccount ?? null,
          vat_code: line.vatCode ?? null,
          cost_centre_id: line.costCentreId ?? null,
          project_id: line.projectId ?? null,
          department_id: line.departmentId ?? null,
          discount,
          net_amount: netAmount,
          vat_amount: vatAmount,
        };
      }),
    )
    .select("*");
  if (linesError) throw linesError;

  return purchaseOrderFromRow({ ...orderRow, purchase_order_lines: lineRows });
}

export async function setOrderStatus(companyId: string, orderId: number, status: PurchaseOrderStatus): Promise<PurchaseOrder> {
  const supabase = await createClient();
  const { error } = await supabase.from("purchase_orders").update({ status }).eq("company_id", companyId).eq("id", orderId);
  if (error) throw error;
  const order = await getPurchaseOrder(companyId, orderId);
  if (!order) throw new Error(`No purchase order with id ${orderId}`);
  return order;
}

/** Adds to a line's `received_quantity` (called from GRN creation) or
 * `billed_quantity` (called from Bill creation) — additive, since a line
 * can be received/billed across several partial documents. Mirrors
 * `sales-order-repository.ts::incrementOrderLineQuantity`. */
export async function incrementOrderLineQuantity(orderLineId: number, field: "received_quantity" | "billed_quantity", amount: number): Promise<void> {
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("purchase_order_lines").select(field).eq("id", orderLineId).single();
  if (readError) throw readError;
  const currentValue = Number((current as Record<string, number>)[field]) || 0;
  const { error } = await supabase
    .from("purchase_order_lines")
    .update({ [field]: Math.round((currentValue + amount) * 100) / 100 })
    .eq("id", orderLineId);
  if (error) throw error;
}
