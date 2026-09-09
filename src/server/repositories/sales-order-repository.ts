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

/** `glAccount`/`vatCode`/`costCentreId`/`projectId`/`departmentId`/
 * `discount`/`netAmount`/`vatAmount` — Finding #113, mirrors
 * `purchase-order-repository.ts::NewPurchaseOrderLine` exactly. All
 * optional: a caller that doesn't supply them gets exactly today's
 * behaviour (no VAT concept, `line_total = quantity*unitPrice`). */
export type NewSalesOrderLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  stockItemId?: number | null;
  glAccount?: string | null;
  vatCode?: string | null;
  costCentreId?: number | null;
  projectId?: number | null;
  departmentId?: number | null;
  discount?: number;
  netAmount?: number;
  vatAmount?: number;
};
export type NewSalesOrder = {
  orderNumber?: string;
  customerId: number;
  quotationId?: number | null;
  orderDate: string;
  notes?: string;
  lines: NewSalesOrderLine[];
};

function toOrderLineRow(orderId: number, line: NewSalesOrderLine, index: number) {
  const discount = line.discount ?? 0;
  const netAmount = line.netAmount ?? Math.round((line.quantity * line.unitPrice - discount) * 100) / 100;
  const vatAmount = line.vatAmount ?? 0;
  return {
    order_id: orderId,
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
}

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
    .insert(input.lines.map((line, index) => toOrderLineRow(orderRow.id, line, index)))
    .select("*");
  if (linesError) throw linesError;

  return salesOrderFromRow({ ...orderRow, sales_order_lines: lineRows });
}

/** Finding #164 — mirrors `purchase-order-repository.ts::replaceOrderLines`
 * exactly. Only ever called for a Draft order (enforced by the service
 * layer) — no delivered/invoiced quantities can exist yet to orphan. */
export async function replaceOrderLines(companyId: string, orderId: number, lines: NewSalesOrderLine[]): Promise<SalesOrder> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase.from("sales_order_lines").delete().eq("order_id", orderId);
  if (deleteError) throw deleteError;

  const { error: linesError } = await supabase.from("sales_order_lines").insert(lines.map((line, index) => toOrderLineRow(orderId, line, index)));
  if (linesError) throw linesError;

  const order = await getSalesOrder(companyId, orderId);
  if (!order) throw new Error(`No sales order with id ${orderId}`);
  return order;
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
 * a line can be delivered/invoiced across several partial documents.
 *
 * Phase 25K — `orderLineId` traces back to client-supplied Delivery/
 * Invoice input with no prior validation that it belongs to `companyId`
 * (or to the order being delivered/invoiced at all). `sales_order_lines`
 * has no `company_id` column of its own, so ownership is confirmed via
 * an inner join to its parent `sales_orders` row — the same join-through
 * pattern `vat-rate-history-repository.ts::listRateHistoryForCompany`
 * already established for a child table one level removed from
 * `company_id`. A line that doesn't resolve under this company is left
 * completely untouched rather than silently corrupting another
 * tenant's order-line quantities. */
export async function incrementOrderLineQuantity(companyId: string, orderLineId: number, field: "delivered_quantity" | "invoiced_quantity", amount: number): Promise<void> {
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("sales_order_lines")
    .select(`${field}, sales_orders!inner(company_id)`)
    .eq("id", orderLineId)
    .eq("sales_orders.company_id", companyId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw new Error(`No sales order line with id ${orderLineId} in company ${companyId}.`);
  const currentValue = Number((current as unknown as Record<string, number>)[field]) || 0;
  const { error } = await supabase
    .from("sales_order_lines")
    .update({ [field]: Math.round((currentValue + amount) * 100) / 100 })
    .eq("id", orderLineId);
  if (error) throw error;
}
