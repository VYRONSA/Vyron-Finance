/**
 * Repository layer for Sales Orders — no accounting impact. Tracks
 * `delivered_quantity`/`invoiced_quantity` per line so Partial
 * Deliveries/Backorders (ordered - delivered) and "has this line been
 * fully invoiced yet" are both real, queryable facts.
 */

import { createClient } from "@/lib/supabase/server";
import { salesOrderFromRow, type SalesOrderRow } from "@/server/sales/mappers";
import type { SalesOrder, SalesOrderStatus } from "@/server/sales/types";

const ORDER_SELECT = "*, sales_order_lines(*)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts's
// own comment on this exact pattern; backed by a real composite index
// (0026_performance_hardening.sql).
const LIST_CAP = 10_000;

export async function nextOrderNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `SO${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listSalesOrders(companyId: string): Promise<SalesOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_orders")
    .select(ORDER_SELECT)
    .eq("company_id", companyId)
    .order("order_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<SalesOrderRow[]>();
  if (error) throw error;
  return data.map(salesOrderFromRow);
}

export async function getSalesOrder(companyId: string, orderId: number): Promise<SalesOrder | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_orders")
    .select(ORDER_SELECT)
    .eq("company_id", companyId)
    .eq("id", orderId)
    .maybeSingle<SalesOrderRow>();
  if (error) throw error;
  return data ? salesOrderFromRow(data) : null;
}

export type NewSalesOrderLine = { description: string; quantity: number; unitPrice: number; stockItemId?: number | null };
export type NewSalesOrder = {
  orderNumber?: string;
  customerId: number;
  quotationId?: number | null;
  orderDate: string;
  notes?: string;
  lines: NewSalesOrderLine[];
};

export async function createSalesOrder(companyId: string, input: NewSalesOrder): Promise<SalesOrder> {
  const supabase = await createClient();
  const orderNumber = input.orderNumber ?? (await nextOrderNumber(companyId));

  const { data: orderRow, error: orderError } = await supabase
    .from("sales_orders")
    .insert({
      company_id: companyId,
      customer_id: input.customerId,
      quotation_id: input.quotationId ?? null,
      order_number: orderNumber,
      order_date: input.orderDate,
      notes: input.notes ?? "",
    })
    .select("*")
    .single<SalesOrderRow>();
  if (orderError) throw orderError;

  const { data: lineRows, error: linesError } = await supabase
    .from("sales_order_lines")
    .insert(
      input.lines.map((line, index) => ({
        order_id: orderRow.id,
        line_order: index,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        line_total: Math.round(line.quantity * line.unitPrice * 100) / 100,
        stock_item_id: line.stockItemId ?? null,
      })),
    )
    .select("*");
  if (linesError) throw linesError;

  return salesOrderFromRow({ ...orderRow, sales_order_lines: lineRows });
}

export async function setOrderStatus(companyId: string, orderId: number, status: SalesOrderStatus): Promise<SalesOrder> {
  const supabase = await createClient();
  const { error } = await supabase.from("sales_orders").update({ status }).eq("company_id", companyId).eq("id", orderId);
  if (error) throw error;
  const order = await getSalesOrder(companyId, orderId);
  if (!order) throw new Error(`No sales order with id ${orderId}`);
  return order;
}

/** Adds to a line's `delivered_quantity` (called from Delivery creation)
 * or `invoiced_quantity` (called from Invoice creation) — additive, since
 * a line can be delivered/invoiced across several partial documents. */
export async function incrementOrderLineQuantity(orderLineId: number, field: "delivered_quantity" | "invoiced_quantity", amount: number): Promise<void> {
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("sales_order_lines").select(field).eq("id", orderLineId).single();
  if (readError) throw readError;
  const currentValue = Number((current as Record<string, number>)[field]) || 0;
  const { error } = await supabase
    .from("sales_order_lines")
    .update({ [field]: Math.round((currentValue + amount) * 100) / 100 })
    .eq("id", orderLineId);
  if (error) throw error;
}
