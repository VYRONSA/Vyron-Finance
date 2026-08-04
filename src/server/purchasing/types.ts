/**
 * Domain types for the Purchasing Platform (Commercial Platform, Module
 * 4). See supabase/migrations/0011_purchasing_platform.sql. Genuinely
 * new — no reference-app equivalent exists. The Supplier Bill type
 * (`ImportedBill`, extended for the new posting workflow) stays in
 * `server/accounting/types.ts` — it is not duplicated here, the same
 * discipline Supplier Management followed for `Supplier`.
 */

export type PurchaseRequisitionStatus = "Draft" | "Submitted" | "Approved" | "Rejected" | "Converted";

export type PurchaseRequisition = {
  id: number;
  companyId: string;
  requisitionNumber: string;
  requestedBy: string;
  departmentId: number | null;
  requisitionDate: string;
  status: PurchaseRequisitionStatus;
  notes: string;
  createdAt: string;
  lines: PurchaseRequisitionLine[];
};

export type PurchaseRequisitionLine = {
  id: number;
  requisitionId: number;
  lineOrder: number;
  description: string;
  quantity: number;
  estimatedUnitPrice: number;
  lineTotal: number;
};

export type PurchaseOrderStatus = "Draft" | "Submitted" | "Approved" | "Rejected" | "PartiallyReceived" | "Received" | "Billed" | "Cancelled";

export type PurchaseOrder = {
  id: number;
  companyId: string;
  supplierId: number;
  requisitionId: number | null;
  orderNumber: string;
  orderDate: string;
  status: PurchaseOrderStatus;
  notes: string;
  createdAt: string;
  lines: PurchaseOrderLine[];
};

export type PurchaseOrderLine = {
  id: number;
  orderId: number;
  lineOrder: number;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  receivedQuantity: number;
  billedQuantity: number;
  /** Real stock item this line orders — null for a service/non-stock
   * line. See `0012_inventory_platform.sql`'s "One Business Object"
   * header comment. */
  stockItemId: number | null;
};

export type GoodsReceivedNoteStatus = "Draft" | "Received" | "Cancelled";

export type GoodsReceivedNote = {
  id: number;
  companyId: string;
  supplierId: number;
  orderId: number | null;
  grnNumber: string;
  receivedDate: string;
  status: GoodsReceivedNoteStatus;
  notes: string;
  createdAt: string;
  lines: GoodsReceivedNoteLine[];
};

export type GoodsReceivedNoteLine = {
  id: number;
  grnId: number;
  orderLineId: number | null;
  lineOrder: number;
  description: string;
  quantity: number;
  stockItemId: number | null;
  unitCost: number;
};

export type SupplierPaymentStatus = "Draft" | "Approved" | "Posted" | "Cancelled";

export type SupplierPayment = {
  id: number;
  companyId: string;
  supplierId: number;
  bankAccountId: number | null;
  paymentNumber: string;
  paymentDate: string;
  amount: number;
  status: SupplierPaymentStatus;
  journalId: number | null;
  reference: string;
  notes: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  allocations: SupplierPaymentAllocation[];
};

export type SupplierPaymentAllocation = {
  id: number;
  paymentId: number;
  billId: number;
  amountAllocated: number;
  createdAt: string;
};
