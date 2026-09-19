/**
 * Preview Mode seed data for the Sales Platform (Commercial Platform,
 * Module 3). Field shapes match the real domain types exactly. Deliberately
 * spans three different real scenarios for the three mock customers: one
 * with an overdue unpaid invoice, one with a fully-paid invoice (so
 * `computeAveragePaymentDays` has real data to compute from), and one
 * brand-new customer with no Sales history at all (a genuine zero, not a
 * fabricated one — Customer 3 truly has no invoices).
 */

import type { CustomerReceipt, Delivery, Quotation, SalesInvoice, SalesOrder } from "@/server/sales/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_QUOTATIONS: Quotation[] = [
  {
    id: 1, companyId: COMPANY_ID, customerId: 1, quotationNumber: "QT000001", quotationDate: "2026-05-20", expiryDate: "2026-06-20",
    status: "Draft", notes: "", createdAt: "2026-05-20T09:00:00Z",
    lines: [{ id: 1, quotationId: 1, lineOrder: 0, description: "Consulting — Q3 review", quantity: 10, unitPrice: 850, lineTotal: 8500, vatCode: null, vatAmount: 0 }],
  },
  {
    id: 2, companyId: COMPANY_ID, customerId: 2, quotationNumber: "QT000002", quotationDate: "2026-07-10", expiryDate: "2026-08-10",
    status: "Sent", notes: "", createdAt: "2026-07-10T09:00:00Z",
    lines: [{ id: 2, quotationId: 2, lineOrder: 0, description: "Annual maintenance plan", quantity: 1, unitPrice: 4500, lineTotal: 4500, vatCode: null, vatAmount: 0 }],
  },
];

export const MOCK_SALES_ORDERS: SalesOrder[] = [
  {
    id: 1, companyId: COMPANY_ID, customerId: 1, quotationId: null, orderNumber: "SO000001", orderDate: "2026-05-25",
    status: "Delivered", notes: "", createdAt: "2026-05-25T09:00:00Z",
    lines: [{ id: 1, orderId: 1, lineOrder: 0, description: "June freight contract", quantity: 1, unitPrice: 5000, lineTotal: 5000, deliveredQuantity: 1, invoicedQuantity: 1, stockItemId: null, glAccount: null, vatCode: null, costCentreId: null, projectId: null, departmentId: null, discount: 0, netAmount: 5000, vatAmount: 0 }],
  },
  {
    id: 2, companyId: COMPANY_ID, customerId: 2, quotationId: null, orderNumber: "SO000002", orderDate: "2026-07-15",
    status: "Confirmed", notes: "", createdAt: "2026-07-15T09:00:00Z",
    lines: [{ id: 2, orderId: 2, lineOrder: 0, description: "Dental supplies restock", quantity: 1, unitPrice: 2000, lineTotal: 2000, deliveredQuantity: 0, invoicedQuantity: 0, stockItemId: null, glAccount: null, vatCode: null, costCentreId: null, projectId: null, departmentId: null, discount: 0, netAmount: 2000, vatAmount: 0 }],
  },
];

export const MOCK_DELIVERIES: Delivery[] = [
  {
    id: 1, companyId: COMPANY_ID, customerId: 1, orderId: 1, deliveryNumber: "DEL000001", deliveryDate: "2026-05-30",
    status: "Delivered", notes: "", createdAt: "2026-05-30T09:00:00Z",
    lines: [{ id: 1, deliveryId: 1, orderLineId: 1, lineOrder: 0, description: "June freight contract", quantity: 1, stockItemId: null }],
  },
];

/* Phase 5J — these documents now reconcile the way real ones do: each
 * line's own net + VAT adds up to that line's total, and the lines add up
 * to the header. They previously carried `vatAmount: 0` on every line
 * alongside a non-zero header VAT, which is exactly the inconsistency
 * this phase removed — Preview Mode would have shown the defect as if it
 * were the design. INV000003 carries a discount and a zero-rated line so
 * Preview Mode exercises both new document columns, and the credit and
 * debit notes carry the s21(3) particulars. */
export const MOCK_SALES_INVOICES: SalesInvoice[] = [
  {
    id: 1, companyId: COMPANY_ID, customerId: 1, orderId: null, deliveryId: null, invoiceNumber: "INV000001", documentType: "Invoice",
    invoiceDate: "2026-06-01", dueDate: "2026-06-30", vatTreatmentCode: "Standard Rated", status: "Posted", journalId: null,
    subtotal: 10000, vatAmount: 1500, total: 11500, outstanding: 11500, isRecurringTemplate: false, recurrencePattern: "",
    reference: "", notes: "", createdAt: "2026-06-01T09:00:00Z", submittedBy: "finance@fenwickrowe.co.za", submittedAt: "2026-06-01T09:05:00Z",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-06-01T10:00:00Z", postedAt: "2026-06-01T10:00:05Z", cancelledBy: null, cancelledAt: null, originalInvoiceId: null, reason: "", paymentTermsDays: 30,
    lines: [{ id: 1, invoiceId: 1, lineOrder: 0, description: "Q2 consulting retainer", quantity: 1, unitPrice: 10000, lineTotal: 11500, stockItemId: null, glAccount: null, vatCode: "Standard Rated", discount: 0, netAmount: 10000, vatAmount: 1500 }],
  },
  {
    id: 2, companyId: COMPANY_ID, customerId: 1, orderId: null, deliveryId: null, invoiceNumber: "INV000002", documentType: "Invoice",
    invoiceDate: "2026-05-01", dueDate: "2026-05-31", vatTreatmentCode: "Standard Rated", status: "Posted", journalId: null,
    subtotal: 5000, vatAmount: 750, total: 5750, outstanding: 0, isRecurringTemplate: false, recurrencePattern: "",
    reference: "", notes: "", createdAt: "2026-05-01T09:00:00Z", submittedBy: "finance@fenwickrowe.co.za", submittedAt: "2026-05-01T09:05:00Z",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-05-01T10:00:00Z", postedAt: "2026-05-01T10:00:05Z", cancelledBy: null, cancelledAt: null, originalInvoiceId: null, reason: "", paymentTermsDays: 30,
    lines: [{ id: 2, invoiceId: 2, lineOrder: 0, description: "Q1 consulting retainer", quantity: 1, unitPrice: 5000, lineTotal: 5750, stockItemId: null, glAccount: null, vatCode: "Standard Rated", discount: 0, netAmount: 5000, vatAmount: 750 }],
  },
  {
    // A discounted, mixed-rate document: 2 x 1,200 less 400 = 2,000 at
    // 15% (300), plus a zero-rated 500 delivery. 2,500 + 300 = 2,800.
    id: 3, companyId: COMPANY_ID, customerId: 2, orderId: null, deliveryId: null, invoiceNumber: "INV000003", documentType: "Invoice",
    invoiceDate: "2026-07-25", dueDate: "2026-08-24", vatTreatmentCode: "Standard Rated", status: "Posted", journalId: null,
    subtotal: 2500, vatAmount: 300, total: 2800, outstanding: 2800, isRecurringTemplate: false, recurrencePattern: "",
    reference: "", notes: "Thank you for your business.", createdAt: "2026-07-25T09:00:00Z", submittedBy: "finance@fenwickrowe.co.za", submittedAt: "2026-07-25T09:05:00Z",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-07-25T10:00:00Z", postedAt: "2026-07-25T10:00:05Z", cancelledBy: null, cancelledAt: null, originalInvoiceId: null, reason: "", paymentTermsDays: 30,
    lines: [
      { id: 3, invoiceId: 3, lineOrder: 0, description: "Dental supplies", quantity: 2, unitPrice: 1200, lineTotal: 2300, stockItemId: null, glAccount: null, vatCode: "Standard Rated", discount: 400, netAmount: 2000, vatAmount: 300 },
      { id: 6, invoiceId: 3, lineOrder: 1, description: "Export delivery — zero rated", quantity: 1, unitPrice: 500, lineTotal: 500, stockItemId: null, glAccount: null, vatCode: "Zero Rated", discount: 0, netAmount: 500, vatAmount: 0 },
    ],
  },
  {
    id: 4, companyId: COMPANY_ID, customerId: 1, orderId: null, deliveryId: null, invoiceNumber: "CN000001", documentType: "Credit Note",
    invoiceDate: "2026-06-15", dueDate: null, vatTreatmentCode: "Standard Rated", status: "Posted", journalId: null,
    subtotal: 1000, vatAmount: 150, total: 1150, outstanding: 0, isRecurringTemplate: false, recurrencePattern: "",
    reference: "Goods returned", notes: "", createdAt: "2026-06-15T09:00:00Z", submittedBy: "finance@fenwickrowe.co.za", submittedAt: "2026-06-15T09:05:00Z",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-06-15T10:00:00Z", postedAt: "2026-06-15T10:00:05Z", cancelledBy: null, cancelledAt: null, originalInvoiceId: 1, reason: "Two units returned damaged on delivery",
    paymentTermsDays: null,
    lines: [{ id: 4, invoiceId: 4, lineOrder: 0, description: "Return — damaged goods", quantity: 1, unitPrice: 1000, lineTotal: 1150, stockItemId: null, glAccount: null, vatCode: "Standard Rated", discount: 0, netAmount: 1000, vatAmount: 150 }],
  },
  {
    id: 5, companyId: COMPANY_ID, customerId: 2, orderId: null, deliveryId: null, invoiceNumber: "DN000001", documentType: "Debit Note",
    invoiceDate: "2026-07-28", dueDate: "2026-08-27", vatTreatmentCode: "Standard Rated", status: "Posted", journalId: null,
    subtotal: 200, vatAmount: 30, total: 230, outstanding: 230, isRecurringTemplate: false, recurrencePattern: "",
    reference: "Freight adjustment", notes: "", createdAt: "2026-07-28T09:00:00Z", submittedBy: "finance@fenwickrowe.co.za", submittedAt: "2026-07-28T09:05:00Z",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-07-28T10:00:00Z", postedAt: "2026-07-28T10:00:05Z", cancelledBy: null, cancelledAt: null, originalInvoiceId: 3, reason: "Freight surcharge omitted from the original invoice",
    paymentTermsDays: 30,
    lines: [{ id: 5, invoiceId: 5, lineOrder: 0, description: "Freight surcharge adjustment", quantity: 1, unitPrice: 200, lineTotal: 230, stockItemId: null, glAccount: null, vatCode: "Standard Rated", discount: 0, netAmount: 200, vatAmount: 30 }],
  },
];

export const MOCK_CUSTOMER_RECEIPTS: CustomerReceipt[] = [
  {
    id: 1, companyId: COMPANY_ID, customerId: 1, bankAccountId: null, receiptNumber: "RCPT000001", receiptDate: "2026-05-20",
    amount: 5750, status: "Posted", journalId: null, reference: "", notes: "", createdAt: "2026-05-20T09:00:00Z",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-05-20T09:30:00Z", postedAt: "2026-05-20T09:30:05Z",
    allocations: [{ id: 1, receiptId: 1, invoiceId: 2, amountAllocated: 5750, createdAt: "2026-05-20T09:30:05Z" }],
  },
];
