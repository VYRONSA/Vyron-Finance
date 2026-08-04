/**
 * Row <-> domain type mappers for the Sales Platform (see
 * supabase/migrations/0010_sales_platform.sql).
 */

import type {
  CustomerReceipt,
  CustomerReceiptAllocation,
  CustomerReceiptStatus,
  Delivery,
  DeliveryLine,
  DeliveryStatus,
  Quotation,
  QuotationLine,
  QuotationStatus,
  SalesInvoice,
  SalesInvoiceDocumentType,
  SalesInvoiceLine,
  SalesInvoiceStatus,
  SalesOrder,
  SalesOrderLine,
  SalesOrderStatus,
} from "./types";

export type QuotationLineRow = {
  id: number;
  quotation_id: number;
  line_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export function quotationLineFromRow(row: QuotationLineRow): QuotationLine {
  return {
    id: row.id,
    quotationId: row.quotation_id,
    lineOrder: row.line_order,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
  };
}

export type QuotationRow = {
  id: number;
  company_id: string;
  customer_id: number;
  quotation_number: string;
  quotation_date: string;
  expiry_date: string | null;
  status: string;
  notes: string;
  created_at: string;
  sales_quotation_lines?: QuotationLineRow[];
};

export function quotationFromRow(row: QuotationRow): Quotation {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    quotationNumber: row.quotation_number,
    quotationDate: row.quotation_date,
    expiryDate: row.expiry_date,
    status: row.status as QuotationStatus,
    notes: row.notes,
    createdAt: row.created_at,
    lines: (row.sales_quotation_lines ?? []).slice().sort((a, b) => a.line_order - b.line_order).map(quotationLineFromRow),
  };
}

export type SalesOrderLineRow = {
  id: number;
  order_id: number;
  line_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  delivered_quantity: number;
  invoiced_quantity: number;
  stock_item_id: number | null;
};

export function salesOrderLineFromRow(row: SalesOrderLineRow): SalesOrderLine {
  return {
    id: row.id,
    orderId: row.order_id,
    lineOrder: row.line_order,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
    deliveredQuantity: Number(row.delivered_quantity),
    invoicedQuantity: Number(row.invoiced_quantity),
    stockItemId: row.stock_item_id,
  };
}

export type SalesOrderRow = {
  id: number;
  company_id: string;
  customer_id: number;
  quotation_id: number | null;
  order_number: string;
  order_date: string;
  status: string;
  notes: string;
  created_at: string;
  sales_order_lines?: SalesOrderLineRow[];
};

export function salesOrderFromRow(row: SalesOrderRow): SalesOrder {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    quotationId: row.quotation_id,
    orderNumber: row.order_number,
    orderDate: row.order_date,
    status: row.status as SalesOrderStatus,
    notes: row.notes,
    createdAt: row.created_at,
    lines: (row.sales_order_lines ?? []).slice().sort((a, b) => a.line_order - b.line_order).map(salesOrderLineFromRow),
  };
}

export type DeliveryLineRow = {
  id: number;
  delivery_id: number;
  order_line_id: number | null;
  line_order: number;
  description: string;
  quantity: number;
  stock_item_id: number | null;
};

export function deliveryLineFromRow(row: DeliveryLineRow): DeliveryLine {
  return {
    id: row.id,
    deliveryId: row.delivery_id,
    orderLineId: row.order_line_id,
    lineOrder: row.line_order,
    description: row.description,
    quantity: Number(row.quantity),
    stockItemId: row.stock_item_id,
  };
}

export type DeliveryRow = {
  id: number;
  company_id: string;
  customer_id: number;
  order_id: number | null;
  delivery_number: string;
  delivery_date: string;
  status: string;
  notes: string;
  created_at: string;
  delivery_lines?: DeliveryLineRow[];
};

export function deliveryFromRow(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    orderId: row.order_id,
    deliveryNumber: row.delivery_number,
    deliveryDate: row.delivery_date,
    status: row.status as DeliveryStatus,
    notes: row.notes,
    createdAt: row.created_at,
    lines: (row.delivery_lines ?? []).slice().sort((a, b) => a.line_order - b.line_order).map(deliveryLineFromRow),
  };
}

export type SalesInvoiceLineRow = {
  id: number;
  invoice_id: number;
  line_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  stock_item_id: number | null;
};

export function salesInvoiceLineFromRow(row: SalesInvoiceLineRow): SalesInvoiceLine {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    lineOrder: row.line_order,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
    stockItemId: row.stock_item_id,
  };
}

export type SalesInvoiceRow = {
  id: number;
  company_id: string;
  customer_id: number;
  order_id: number | null;
  delivery_id: number | null;
  invoice_number: string;
  document_type: string;
  invoice_date: string;
  due_date: string | null;
  vat_treatment_code: string;
  status: string;
  journal_id: number | null;
  subtotal: number;
  vat_amount: number;
  total: number;
  outstanding: number;
  is_recurring_template: boolean;
  recurrence_pattern: string;
  reference: string;
  notes: string;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  sales_invoice_lines?: SalesInvoiceLineRow[];
};

export function salesInvoiceFromRow(row: SalesInvoiceRow): SalesInvoice {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    orderId: row.order_id,
    deliveryId: row.delivery_id,
    invoiceNumber: row.invoice_number,
    documentType: row.document_type as SalesInvoiceDocumentType,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    vatTreatmentCode: row.vat_treatment_code,
    status: row.status as SalesInvoiceStatus,
    journalId: row.journal_id,
    subtotal: Number(row.subtotal),
    vatAmount: Number(row.vat_amount),
    total: Number(row.total),
    outstanding: Number(row.outstanding),
    isRecurringTemplate: row.is_recurring_template,
    recurrencePattern: row.recurrence_pattern,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.created_at,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    postedAt: row.posted_at,
    cancelledBy: row.cancelled_by,
    cancelledAt: row.cancelled_at,
    lines: (row.sales_invoice_lines ?? []).slice().sort((a, b) => a.line_order - b.line_order).map(salesInvoiceLineFromRow),
  };
}

export type CustomerReceiptAllocationRow = {
  id: number;
  receipt_id: number;
  invoice_id: number;
  amount_allocated: number;
  created_at: string;
};

export function customerReceiptAllocationFromRow(row: CustomerReceiptAllocationRow): CustomerReceiptAllocation {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    invoiceId: row.invoice_id,
    amountAllocated: Number(row.amount_allocated),
    createdAt: row.created_at,
  };
}

export type CustomerReceiptRow = {
  id: number;
  company_id: string;
  customer_id: number;
  bank_account_id: number | null;
  receipt_number: string;
  receipt_date: string;
  amount: number;
  status: string;
  journal_id: number | null;
  reference: string;
  notes: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  posted_at: string | null;
  customer_receipt_allocations?: CustomerReceiptAllocationRow[];
};

export function customerReceiptFromRow(row: CustomerReceiptRow): CustomerReceipt {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    bankAccountId: row.bank_account_id,
    receiptNumber: row.receipt_number,
    receiptDate: row.receipt_date,
    amount: Number(row.amount),
    status: row.status as CustomerReceiptStatus,
    journalId: row.journal_id,
    reference: row.reference,
    notes: row.notes,
    createdAt: row.created_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    postedAt: row.posted_at,
    allocations: (row.customer_receipt_allocations ?? []).map(customerReceiptAllocationFromRow),
  };
}
