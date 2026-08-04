/**
 * Repository layer for Goods Received Notes — no accounting impact (no
 * Inventory/COGS module exists yet to value what was received); tracks
 * fulfillment only. Mirrors `delivery-repository.ts` exactly. Creating a
 * GRN against order lines increments those lines' `received_quantity`
 * (see `purchase-order-repository.ts::incrementOrderLineQuantity`).
 */

import { createClient } from "@/lib/supabase/server";
import { incrementOrderLineQuantity } from "@/server/repositories/purchase-order-repository";
import { goodsReceivedNoteFromRow, type GoodsReceivedNoteRow } from "@/server/purchasing/mappers";
import type { GoodsReceivedNote, GoodsReceivedNoteStatus } from "@/server/purchasing/types";

const GRN_SELECT = "*, goods_received_note_lines(*)";

// RC1 Phase 3 (Performance Hardening) — see customer-repository.ts::LIST_CAP
// for the full rationale; same safety bound applied here.
const LIST_CAP = 10_000;

export async function nextGrnNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("goods_received_notes").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `GRN${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listGoodsReceivedNotes(companyId: string): Promise<GoodsReceivedNote[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goods_received_notes")
    .select(GRN_SELECT)
    .eq("company_id", companyId)
    .order("received_date", { ascending: false })
    .limit(LIST_CAP)
    .returns<GoodsReceivedNoteRow[]>();
  if (error) throw error;
  return data.map(goodsReceivedNoteFromRow);
}

export async function getGoodsReceivedNote(companyId: string, grnId: number): Promise<GoodsReceivedNote | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goods_received_notes")
    .select(GRN_SELECT)
    .eq("company_id", companyId)
    .eq("id", grnId)
    .maybeSingle<GoodsReceivedNoteRow>();
  if (error) throw error;
  return data ? goodsReceivedNoteFromRow(data) : null;
}

export type NewGoodsReceivedNoteLine = { orderLineId?: number | null; description: string; quantity: number; stockItemId?: number | null; unitCost?: number };
export type NewGoodsReceivedNote = {
  grnNumber?: string;
  supplierId: number;
  orderId?: number | null;
  receivedDate: string;
  notes?: string;
  lines: NewGoodsReceivedNoteLine[];
};

export async function createGoodsReceivedNote(companyId: string, input: NewGoodsReceivedNote): Promise<GoodsReceivedNote> {
  const supabase = await createClient();
  const grnNumber = input.grnNumber ?? (await nextGrnNumber(companyId));

  const { data: grnRow, error: grnError } = await supabase
    .from("goods_received_notes")
    .insert({
      company_id: companyId,
      supplier_id: input.supplierId,
      order_id: input.orderId ?? null,
      grn_number: grnNumber,
      received_date: input.receivedDate,
      notes: input.notes ?? "",
    })
    .select("*")
    .single<GoodsReceivedNoteRow>();
  if (grnError) throw grnError;

  const { data: lineRows, error: linesError } = await supabase
    .from("goods_received_note_lines")
    .insert(
      input.lines.map((line, index) => ({
        grn_id: grnRow.id,
        order_line_id: line.orderLineId ?? null,
        line_order: index,
        description: line.description,
        quantity: line.quantity,
        stock_item_id: line.stockItemId ?? null,
        unit_cost: line.unitCost ?? 0,
      })),
    )
    .select("*");
  if (linesError) throw linesError;

  for (const line of input.lines) {
    if (line.orderLineId) await incrementOrderLineQuantity(line.orderLineId, "received_quantity", line.quantity);
  }

  return goodsReceivedNoteFromRow({ ...grnRow, goods_received_note_lines: lineRows });
}

export async function setGrnStatus(companyId: string, grnId: number, status: GoodsReceivedNoteStatus): Promise<GoodsReceivedNote> {
  const supabase = await createClient();
  const { error } = await supabase.from("goods_received_notes").update({ status }).eq("company_id", companyId).eq("id", grnId);
  if (error) throw error;
  const grn = await getGoodsReceivedNote(companyId, grnId);
  if (!grn) throw new Error(`No goods received note with id ${grnId}`);
  return grn;
}
