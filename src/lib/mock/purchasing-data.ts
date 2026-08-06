/**
 * Preview Mode seed data for the Purchasing Platform (Commercial
 * Platform, Module 4). Field shapes match the real domain types exactly.
 * `MOCK_PURCHASE_BILLS` are separate from `MOCK_BILLS`
 * (`supplier-reconciliation-data.ts`) — those are `origin: "Imported"`,
 * these are `origin: "Purchasing"` — real bills entered through the new
 * workflow, with fresh ids so the two arrays can be concatenated for a
 * supplier's full bill list exactly like the real repository does.
 * Deliberately spans three scenarios across the three mock suppliers: an
 * overdue unpaid bill, a fully-paid bill (so `computeAveragePaymentDays`
 * has real data), and a supplier with zero Purchasing-entered bills (a
 * genuine zero — Harrow Print & Design only has its one imported bill).
 */

import type { ImportedBill } from "@/server/accounting/types";
import type { GoodsReceivedNote, PurchaseOrder, PurchaseRequisition, SupplierPayment } from "@/server/purchasing/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_PURCHASE_REQUISITIONS: PurchaseRequisition[] = [
  {
    id: 1, companyId: COMPANY_ID, requisitionNumber: "PR000001", requestedBy: "ops@fenwickrowe.co.za", departmentId: null,
    requisitionDate: "2026-05-18", status: "Draft", notes: "", createdAt: "2026-05-18T09:00:00Z",
    lines: [{ id: 1, requisitionId: 1, lineOrder: 0, description: "Toner and paper restock", quantity: 10, estimatedUnitPrice: 45, lineTotal: 450 }],
  },
  {
    id: 2, companyId: COMPANY_ID, requisitionNumber: "PR000002", requestedBy: "logistics@fenwickrowe.co.za", departmentId: null,
    requisitionDate: "2026-07-05", status: "Approved", notes: "", createdAt: "2026-07-05T09:00:00Z",
    lines: [{ id: 2, requisitionId: 2, lineOrder: 0, description: "July freight contract", quantity: 1, estimatedUnitPrice: 4800, lineTotal: 4800 }],
  },
];

export const MOCK_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 1, companyId: COMPANY_ID, supplierId: 1, requisitionId: null, orderNumber: "PO000001", orderDate: "2026-05-25",
    status: "Received", notes: "", createdAt: "2026-05-25T09:00:00Z",
    lines: [{ id: 1, orderId: 1, lineOrder: 0, description: "Office supplies restock", quantity: 1, unitPrice: 4500, lineTotal: 4500, receivedQuantity: 1, billedQuantity: 1, stockItemId: null, glAccount: null, vatCode: null, costCentreId: null, projectId: null, departmentId: null, discount: 0, netAmount: 4500, vatAmount: 0 }],
  },
  {
    id: 2, companyId: COMPANY_ID, supplierId: 2, requisitionId: 2, orderNumber: "PO000002", orderDate: "2026-07-15",
    status: "Submitted", notes: "", createdAt: "2026-07-15T09:00:00Z",
    lines: [{ id: 2, orderId: 2, lineOrder: 0, description: "July freight contract", quantity: 1, unitPrice: 4800, lineTotal: 4800, receivedQuantity: 0, billedQuantity: 0, stockItemId: null, glAccount: null, vatCode: null, costCentreId: null, projectId: null, departmentId: null, discount: 0, netAmount: 4800, vatAmount: 0 }],
  },
];

export const MOCK_GOODS_RECEIVED_NOTES: GoodsReceivedNote[] = [
  {
    id: 1, companyId: COMPANY_ID, supplierId: 1, orderId: 1, grnNumber: "GRN000001", receivedDate: "2026-05-30",
    status: "Received", notes: "", createdAt: "2026-05-30T09:00:00Z",
    lines: [{ id: 1, grnId: 1, orderLineId: 1, lineOrder: 0, description: "Office supplies restock", quantity: 1, stockItemId: null, unitCost: 0 }],
  },
];

const PURCHASING_BILL_DEFAULTS = {
  status: "Open",
  glAccount: null,
  vatCode: "Standard Rated",
  origin: "Purchasing" as const,
};

export const MOCK_PURCHASE_BILLS: ImportedBill[] = [
  {
    id: 101, companyId: COMPANY_ID, supplierId: 1, supplierName: "Fenwick Office Supplies", invoiceNumber: "FOS-8891", documentType: "Bill",
    invoiceDate: "2026-06-01", dueDate: "2026-06-30", vat: 675, total: 5175, outstanding: 5175,
    purchaseOrderId: 1, goodsReceivedNoteId: 1, postingStatus: "Posted", journalId: null,
    submittedBy: "ap@fenwickrowe.co.za", submittedAt: "2026-06-01T09:05:00Z", approvedBy: "controller@fenwickrowe.co.za",
    approvedAt: "2026-06-01T10:00:00Z", postedAt: "2026-06-01T10:00:05Z", cancelledBy: null, cancelledAt: null,
    ...PURCHASING_BILL_DEFAULTS,
  },
  {
    id: 102, companyId: COMPANY_ID, supplierId: 1, supplierName: "Fenwick Office Supplies", invoiceNumber: "FOS-8760", documentType: "Bill",
    invoiceDate: "2026-05-01", dueDate: "2026-05-31", vat: 300, total: 2300, outstanding: 0,
    purchaseOrderId: null, goodsReceivedNoteId: null, postingStatus: "Posted", journalId: null,
    submittedBy: "ap@fenwickrowe.co.za", submittedAt: "2026-05-01T09:05:00Z", approvedBy: "controller@fenwickrowe.co.za",
    approvedAt: "2026-05-01T10:00:00Z", postedAt: "2026-05-01T10:00:05Z", cancelledBy: null, cancelledAt: null,
    ...PURCHASING_BILL_DEFAULTS,
  },
  {
    id: 103, companyId: COMPANY_ID, supplierId: 2, supplierName: "Netherfield Freight Ltd", invoiceNumber: "NF-9910", documentType: "Bill",
    invoiceDate: "2026-07-25", dueDate: "2026-08-08", vat: 720, total: 5520, outstanding: 5520,
    purchaseOrderId: null, goodsReceivedNoteId: null, postingStatus: "Posted", journalId: null,
    submittedBy: "ap@fenwickrowe.co.za", submittedAt: "2026-07-25T09:05:00Z", approvedBy: "controller@fenwickrowe.co.za",
    approvedAt: "2026-07-25T10:00:00Z", postedAt: "2026-07-25T10:00:05Z", cancelledBy: null, cancelledAt: null,
    ...PURCHASING_BILL_DEFAULTS,
  },
];

export const MOCK_SUPPLIER_PAYMENTS: SupplierPayment[] = [
  {
    id: 1, companyId: COMPANY_ID, supplierId: 1, bankAccountId: null, paymentNumber: "PAY000001", paymentDate: "2026-05-20",
    amount: 2300, status: "Posted", journalId: null, reference: "", notes: "", createdAt: "2026-05-20T09:00:00Z",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-05-20T09:30:00Z", postedAt: "2026-05-20T09:30:05Z",
    allocations: [{ id: 1, paymentId: 1, billId: 102, amountAllocated: 2300, createdAt: "2026-05-20T09:30:05Z" }],
  },
];
