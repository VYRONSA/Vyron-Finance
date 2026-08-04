/**
 * Row <-> domain type mappers for the Purchasing Platform (see
 * supabase/migrations/0011_purchasing_platform.sql).
 */

import type {
  GoodsReceivedNote,
  GoodsReceivedNoteLine,
  GoodsReceivedNoteStatus,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  PurchaseRequisition,
  PurchaseRequisitionLine,
  PurchaseRequisitionStatus,
  SupplierPayment,
  SupplierPaymentAllocation,
  SupplierPaymentStatus,
} from "./types";

export type PurchaseRequisitionLineRow = {
  id: number;
  requisition_id: number;
  line_order: number;
  description: string;
  quantity: number;
  estimated_unit_price: number;
  line_total: number;
};

export function purchaseRequisitionLineFromRow(row: PurchaseRequisitionLineRow): PurchaseRequisitionLine {
  return {
    id: row.id,
    requisitionId: row.requisition_id,
    lineOrder: row.line_order,
    description: row.description,
    quantity: Number(row.quantity),
    estimatedUnitPrice: Number(row.estimated_unit_price),
    lineTotal: Number(row.line_total),
  };
}

export type PurchaseRequisitionRow = {
  id: number;
  company_id: string;
  requisition_number: string;
  requested_by: string;
  department_id: number | null;
  requisition_date: string;
  status: string;
  notes: string;
  created_at: string;
  purchase_requisition_lines?: PurchaseRequisitionLineRow[];
};

export function purchaseRequisitionFromRow(row: PurchaseRequisitionRow): PurchaseRequisition {
  return {
    id: row.id,
    companyId: row.company_id,
    requisitionNumber: row.requisition_number,
    requestedBy: row.requested_by,
    departmentId: row.department_id,
    requisitionDate: row.requisition_date,
    status: row.status as PurchaseRequisitionStatus,
    notes: row.notes,
    createdAt: row.created_at,
    lines: (row.purchase_requisition_lines ?? []).slice().sort((a, b) => a.line_order - b.line_order).map(purchaseRequisitionLineFromRow),
  };
}

export type PurchaseOrderLineRow = {
  id: number;
  order_id: number;
  line_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  received_quantity: number;
  billed_quantity: number;
  stock_item_id: number | null;
};

export function purchaseOrderLineFromRow(row: PurchaseOrderLineRow): PurchaseOrderLine {
  return {
    id: row.id,
    orderId: row.order_id,
    lineOrder: row.line_order,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
    receivedQuantity: Number(row.received_quantity),
    billedQuantity: Number(row.billed_quantity),
    stockItemId: row.stock_item_id,
  };
}

export type PurchaseOrderRow = {
  id: number;
  company_id: string;
  supplier_id: number;
  requisition_id: number | null;
  order_number: string;
  order_date: string;
  status: string;
  notes: string;
  created_at: string;
  purchase_order_lines?: PurchaseOrderLineRow[];
};

export function purchaseOrderFromRow(row: PurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id,
    companyId: row.company_id,
    supplierId: row.supplier_id,
    requisitionId: row.requisition_id,
    orderNumber: row.order_number,
    orderDate: row.order_date,
    status: row.status as PurchaseOrderStatus,
    notes: row.notes,
    createdAt: row.created_at,
    lines: (row.purchase_order_lines ?? []).slice().sort((a, b) => a.line_order - b.line_order).map(purchaseOrderLineFromRow),
  };
}

export type GoodsReceivedNoteLineRow = {
  id: number;
  grn_id: number;
  order_line_id: number | null;
  line_order: number;
  description: string;
  quantity: number;
  stock_item_id: number | null;
  unit_cost: number;
};

export function goodsReceivedNoteLineFromRow(row: GoodsReceivedNoteLineRow): GoodsReceivedNoteLine {
  return {
    id: row.id,
    grnId: row.grn_id,
    orderLineId: row.order_line_id,
    lineOrder: row.line_order,
    description: row.description,
    quantity: Number(row.quantity),
    stockItemId: row.stock_item_id,
    unitCost: Number(row.unit_cost),
  };
}

export type GoodsReceivedNoteRow = {
  id: number;
  company_id: string;
  supplier_id: number;
  order_id: number | null;
  grn_number: string;
  received_date: string;
  status: string;
  notes: string;
  created_at: string;
  goods_received_note_lines?: GoodsReceivedNoteLineRow[];
};

export function goodsReceivedNoteFromRow(row: GoodsReceivedNoteRow): GoodsReceivedNote {
  return {
    id: row.id,
    companyId: row.company_id,
    supplierId: row.supplier_id,
    orderId: row.order_id,
    grnNumber: row.grn_number,
    receivedDate: row.received_date,
    status: row.status as GoodsReceivedNoteStatus,
    notes: row.notes,
    createdAt: row.created_at,
    lines: (row.goods_received_note_lines ?? []).slice().sort((a, b) => a.line_order - b.line_order).map(goodsReceivedNoteLineFromRow),
  };
}

export type SupplierPaymentAllocationRow = {
  id: number;
  payment_id: number;
  bill_id: number;
  amount_allocated: number;
  created_at: string;
};

export function supplierPaymentAllocationFromRow(row: SupplierPaymentAllocationRow): SupplierPaymentAllocation {
  return {
    id: row.id,
    paymentId: row.payment_id,
    billId: row.bill_id,
    amountAllocated: Number(row.amount_allocated),
    createdAt: row.created_at,
  };
}

export type SupplierPaymentRow = {
  id: number;
  company_id: string;
  supplier_id: number;
  bank_account_id: number | null;
  payment_number: string;
  payment_date: string;
  amount: number;
  status: string;
  journal_id: number | null;
  reference: string;
  notes: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  posted_at: string | null;
  supplier_payment_allocations?: SupplierPaymentAllocationRow[];
};

export function supplierPaymentFromRow(row: SupplierPaymentRow): SupplierPayment {
  return {
    id: row.id,
    companyId: row.company_id,
    supplierId: row.supplier_id,
    bankAccountId: row.bank_account_id,
    paymentNumber: row.payment_number,
    paymentDate: row.payment_date,
    amount: Number(row.amount),
    status: row.status as SupplierPaymentStatus,
    journalId: row.journal_id,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.created_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    postedAt: row.posted_at,
    allocations: (row.supplier_payment_allocations ?? []).map(supplierPaymentAllocationFromRow),
  };
}
