/**
 * Repository layer for Purchase Requisitions — no accounting impact,
 * mirrors `quotation-repository.ts` exactly (an internal request is a
 * commitment, not a transaction).
 */

import { createClient } from "@/lib/supabase/server";
import { purchaseRequisitionFromRow, type PurchaseRequisitionRow } from "@/server/purchasing/mappers";
import type { PurchaseRequisition, PurchaseRequisitionStatus } from "@/server/purchasing/types";

const REQUISITION_SELECT = "*, purchase_requisition_lines(*)";

export async function nextRequisitionNumber(companyId: string): Promise<string> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("purchase_requisitions").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (error) throw error;
  return `PR${String((count ?? 0) + 1).padStart(6, "0")}`;
}

export async function listPurchaseRequisitions(companyId: string): Promise<PurchaseRequisition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_requisitions")
    .select(REQUISITION_SELECT)
    .eq("company_id", companyId)
    .order("requisition_date", { ascending: false })
    .returns<PurchaseRequisitionRow[]>();
  if (error) throw error;
  return data.map(purchaseRequisitionFromRow);
}

export async function getPurchaseRequisition(companyId: string, requisitionId: number): Promise<PurchaseRequisition | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_requisitions")
    .select(REQUISITION_SELECT)
    .eq("company_id", companyId)
    .eq("id", requisitionId)
    .maybeSingle<PurchaseRequisitionRow>();
  if (error) throw error;
  return data ? purchaseRequisitionFromRow(data) : null;
}

export type NewPurchaseRequisitionLine = { description: string; quantity: number; estimatedUnitPrice: number };
export type NewPurchaseRequisition = {
  requisitionNumber?: string;
  requestedBy?: string;
  departmentId?: number | null;
  requisitionDate: string;
  notes?: string;
  lines: NewPurchaseRequisitionLine[];
};

export async function createPurchaseRequisition(companyId: string, input: NewPurchaseRequisition): Promise<PurchaseRequisition> {
  const supabase = await createClient();
  const requisitionNumber = input.requisitionNumber ?? (await nextRequisitionNumber(companyId));

  const { data: requisitionRow, error: requisitionError } = await supabase
    .from("purchase_requisitions")
    .insert({
      company_id: companyId,
      requisition_number: requisitionNumber,
      requested_by: input.requestedBy ?? "",
      department_id: input.departmentId ?? null,
      requisition_date: input.requisitionDate,
      notes: input.notes ?? "",
    })
    .select("*")
    .single<PurchaseRequisitionRow>();
  if (requisitionError) throw requisitionError;

  const { data: lineRows, error: linesError } = await supabase
    .from("purchase_requisition_lines")
    .insert(
      input.lines.map((line, index) => ({
        requisition_id: requisitionRow.id,
        line_order: index,
        description: line.description,
        quantity: line.quantity,
        estimated_unit_price: line.estimatedUnitPrice,
        line_total: Math.round(line.quantity * line.estimatedUnitPrice * 100) / 100,
      })),
    )
    .select("*");
  if (linesError) throw linesError;

  return purchaseRequisitionFromRow({ ...requisitionRow, purchase_requisition_lines: lineRows });
}

export async function setRequisitionStatus(companyId: string, requisitionId: number, status: PurchaseRequisitionStatus): Promise<PurchaseRequisition> {
  const supabase = await createClient();
  const { error } = await supabase.from("purchase_requisitions").update({ status }).eq("company_id", companyId).eq("id", requisitionId);
  if (error) throw error;
  const requisition = await getPurchaseRequisition(companyId, requisitionId);
  if (!requisition) throw new Error(`No purchase requisition with id ${requisitionId}`);
  return requisition;
}
