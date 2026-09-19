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
  /** Finding #112 — mirrors the Sales Order/Purchase Order VAT fields
   * (0071/0060). Null on a line that hasn't been VAT-treated (every
   * pre-existing row): `vatAmount` computes to 0 and `lineTotal` stays
   * exactly quantity*unitPrice, unchanged. */
  vatCode: string | null;
  vatAmount: number;
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
  // Finding #113 — mirrors purchase-order's own line dimensions
  // (0071/0060_purchase_order_line_dimensions.sql). All nullable/default:
  // an order captured before this existed simply has none of them set,
  // and `lineTotal` stays exactly what it always was.
  glAccount: string | null;
  vatCode: string | null;
  costCentreId: number | null;
  projectId: number | null;
  departmentId: number | null;
  discount: number;
  netAmount: number;
  vatAmount: number;
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
  /** Finding #114 — which Invoice this Credit Note reverses; always null
   * for a real Invoice/Debit Note.
   *
   * Phase 5J — still nullable at the DATA layer, because credit notes
   * issued before 5J genuinely do not name one and rewriting them to
   * pretend otherwise would falsify a tax record. New credit and debit
   * notes must name one: `sales-invoice-service.ts` requires it at
   * creation (VAT Act s21(3) — the note must carry enough detail to
   * identify the original tax invoice). */
  originalInvoiceId: number | null;
  /** Phase 5J — why this Credit/Debit Note was issued (VAT Act s21(3)).
   * Always `""` on an Invoice, and `""` on a note issued before 0106
   * added the column: those have no reason on record, and the document
   * prints that honestly rather than inventing one. */
  reason: string;
  /** Phase 5J — the payment terms this document's `dueDate` was derived
   * from, captured at issue so a later edit to the customer's terms
   * cannot silently re-date an invoice already sent. Null when the due
   * date was set by hand, or on any document predating 0106. */
  paymentTermsDays: number | null;
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
  // Finding #165 — per-line VAT/discount, mirroring Sales Order/Purchase
  // Order's own optional line dimensions (0071/0060), not Purchase
  // Bill's required ones — an Invoice already has a header-level
  // vatTreatmentCode a line can optionally override.
  glAccount: string | null;
  vatCode: string | null;
  discount: number;
  netAmount: number;
  vatAmount: number;
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
