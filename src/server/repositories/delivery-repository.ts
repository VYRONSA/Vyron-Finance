/**
 * Repository layer for Deliveries — no accounting impact (no Inventory/
 * COGS module exists yet to value what was delivered); tracks fulfillment
 * only. Creating a Delivery against order lines increments those lines'
 * `delivered_quantity` (see `sales-order-repository.ts::incrementOrderLineQuantity`),
 * which is what makes Partial Deliveries/Backorders real, queryable facts.
 */

import { createClient } from "@/lib/supabase/server";
import { incrementOrderLineQuantity } from "@/server/repositories/sales-order-repository";
import { deliveryFromRow, type DeliveryRow } from "@/server/sales/mappers";
import type { Delivery, DeliveryStatus } from "@/server/sales/types";

const DELIVERY_SELECT = "*, delivery_lines(*)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the full rationale; same safety bound applied here.
const LIST_CAP = 10_000;

export async function nextDeliveryNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("deliveries").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `DEL${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listDeliveries(companyId: string): Promise<Delivery[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deliveries")
    .select(DELIVERY_SELECT)
    .eq("company_id", companyId)
    .order("delivery_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<DeliveryRow[]>();
  if (error) throw error;
  return data.map(deliveryFromRow);
}

export async function getDelivery(companyId: string, deliveryId: number): Promise<Delivery | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deliveries")
    .select(DELIVERY_SELECT)
    .eq("company_id", companyId)
    .eq("id", deliveryId)
    .maybeSingle<DeliveryRow>();
  if (error) throw error;
  return data ? deliveryFromRow(data) : null;
}

export type NewDeliveryLine = { orderLineId?: number | null; description: string; quantity: number; stockItemId?: number | null };
export type NewDelivery = {
  deliveryNumber?: string;
  customerId: number;
  orderId?: number | null;
  deliveryDate: string;
  notes?: string;
  lines: NewDeliveryLine[];
};

export async function createDelivery(companyId: string, input: NewDelivery): Promise<Delivery> {
  const supabase = await createClient();
  const deliveryNumber = input.deliveryNumber ?? (await nextDeliveryNumber(companyId));

  const { data: deliveryRow, error: deliveryError } = await supabase
    .from("deliveries")
    .insert({
      company_id: companyId,
      customer_id: input.customerId,
      order_id: input.orderId ?? null,
      delivery_number: deliveryNumber,
      delivery_date: input.deliveryDate,
      notes: input.notes ?? "",
    })
    .select("*")
    .single<DeliveryRow>();
  if (deliveryError) throw deliveryError;

  const { data: lineRows, error: linesError } = await supabase
    .from("delivery_lines")
    .insert(
      input.lines.map((line, index) => ({
        delivery_id: deliveryRow.id,
        order_line_id: line.orderLineId ?? null,
        line_order: index,
        description: line.description,
        quantity: line.quantity,
        stock_item_id: line.stockItemId ?? null,
      })),
    )
    .select("*");
  if (linesError) throw linesError;

  for (const line of input.lines) {
    if (line.orderLineId) await incrementOrderLineQuantity(line.orderLineId, "delivered_quantity", line.quantity);
  }

  return deliveryFromRow({ ...deliveryRow, delivery_lines: lineRows });
}

export async function setDeliveryStatus(companyId: string, deliveryId: number, status: DeliveryStatus): Promise<Delivery> {
  const supabase = await createClient();
  const { error } = await supabase.from("deliveries").update({ status }).eq("company_id", companyId).eq("id", deliveryId);
  if (error) throw error;
  const delivery = await getDelivery(companyId, deliveryId);
  if (!delivery) throw new Error(`No delivery with id ${deliveryId}`);
  return delivery;
}
