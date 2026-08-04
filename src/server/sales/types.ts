/**
 * Domain types for the Sales Platform (Commercial Platform, Module 3).
 * See supabase/migrations/0010_sales_platform.sql. Genuinely new — no
 * reference-app equivalent exists.
 */

export type QuotationStatus = "Draft" | "Sent" | "Accepted" | "Rejected" | "Expired" | "Converted";

export type Quotation = {
  id: number;
  companyId: string;
  customerId: number;
  quotationNumber: string;
  quotationDate: string;
  expiryDate: string | null;
  status: QuotationStatus;
  notes: string;
  createdAt: string;
  lines: QuotationLine[];
};

export type QuotationLine = {
  id: number;
  quotationId: number;
  lineOrder: number;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type SalesOrderStatus = "Draft" | "Confirmed" | "PartiallyDelivered" | "Delivered" | "Invoiced" | "Cancelled";

export type SalesOrder = {
  id: number;
  companyId: string;
  customerId: number;
  quotationId: number | null;
  orderNumber: string;
  orderDate: string;
  status: SalesOrderStatus;
  notes: string;
  createdAt: string;
  lines: SalesOrderLine[];
};

export type SalesOrderLine = {
  id: number;
  orderId: number;
  lineOrder: number;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  deliveredQuantity: number;
  invoicedQuantity: number;
  stockItemId: number | null;
};

export type DeliveryStatus = "Draft" | "Delivered" | "Cancelled";

export type Delivery = {
  id: number;
  companyId: string;
  customerId: number;
  orderId: number | null;
  deliveryNumber: string;
  deliveryDate: string;
  status: DeliveryStatus;
  notes: string;
  createdAt: string;
  lines: DeliveryLine[];
};

export type DeliveryLine = {
  id: number;
  deliveryId: number;
  orderLineId: number | null;
  lineOrder: number;
  description: string;
  quantity: number;
  stockItemId: number | null;
};

export type SalesInvoiceDocumentType = "Invoice" | "Credit Note" | "Debit Note";
export type SalesInvoiceStatus = "Draft" | "Submitted" | "Approved" | "Posted" | "Cancelled";

export type SalesInvoice = {
  id: number;
  companyId: string;
  customerId: number;
  orderId: number | null;
  deliveryId: number | null;
  invoiceNumber: string;
  documentType: SalesInvoiceDocumentType;
  invoiceDate: string;
  dueDate: string | null;
  vatTreatmentCode: string;
  status: SalesInvoiceStatus;
  journalId: number | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  outstanding: number;
  isRecurringTemplate: boolean;
  recurrencePattern: string;
  reference: string;
  notes: string;
  createdAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  lines: SalesInvoiceLine[];
};

export type SalesInvoiceLine = {
  id: number;
  invoiceId: number;
  lineOrder: number;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Real stock item this line sells — null for a service/non-stock
   * line. See `0012_inventory_platform.sql`'s "One Business Object"
   * header comment. */
  stockItemId: number | null;
};

export type CustomerReceiptStatus = "Draft" | "Approved" | "Posted" | "Cancelled";

export type CustomerReceipt = {
  id: number;
  companyId: string;
  customerId: number;
  bankAccountId: number | null;
  receiptNumber: string;
  receiptDate: string;
  amount: number;
  status: CustomerReceiptStatus;
  journalId: number | null;
  reference: string;
  notes: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  allocations: CustomerReceiptAllocation[];
};

export type CustomerReceiptAllocation = {
  id: number;
  receiptId: number;
  invoiceId: number;
  amountAllocated: number;
  createdAt: string;
};
