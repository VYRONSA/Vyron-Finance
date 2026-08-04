/**
 * Preview Mode seed data for the Matching Platform (Module 14). The
 * queue and duplicate findings are DERIVED via the real pure engines
 * (`detectDuplicatePayments`, `runDuplicateCustomersTest`,
 * `runDuplicateSuppliersTest`) and real filters over the SAME mock
 * arrays every prior module's own mock file already established — not
 * hand-typed, matching this session's "derived, not hand-typed"
 * discipline.
 */

import { detectDuplicatePayments } from "@/server/banking-rules/banking-intelligence";
import { runDuplicateCustomersTest, runDuplicateSuppliersTest, type AuditTestFinding } from "@/server/audit/audit-tests-engine";
import { buildMatchingSummary, type MatchingSummary } from "@/server/services/matching-summary-service";
import type { MatchingQueueItem } from "@/server/services/matching-queue-service";
import { findAllocationCandidates } from "@/server/matching/receipt-allocation-matching-engine";
import { findPaymentAllocationCandidates } from "@/server/matching/payment-allocation-matching-engine";
import { buildDuplicateFindings, type DuplicateFinding } from "@/server/matching/duplicate-detection-engine";
import type { CustomerMatchingWorkspaceData } from "@/server/services/customer-matching-service";
import type { SupplierMatchingWorkspaceData } from "@/server/services/supplier-matching-service";
import { MOCK_COMPANY } from "./financial-data";
import { MOCK_TRANSACTIONS, MOCK_BANKING_AGGREGATE } from "./transaction-explorer-data";
import { MOCK_BANKING_EXCEPTIONS, MOCK_MERCHANTS } from "./banking-automation-data";
import { MOCK_SALES_INVOICES, MOCK_CUSTOMER_RECEIPTS, MOCK_SALES_ORDERS, MOCK_QUOTATIONS } from "./sales-data";
import { MOCK_BILLS } from "./supplier-reconciliation-data";
import { MOCK_SUPPLIER_PAYMENTS, MOCK_PURCHASE_ORDERS } from "./purchasing-data";
import { MOCK_CASHBOOK_TRANSACTIONS } from "./cashbook-data";
import { MOCK_CUSTOMERS } from "./customer-management-data";
import { MOCK_SUPPLIERS } from "./supplier-reconciliation-data";
import { MOCK_STOCK_ITEMS } from "./inventory-data";
import { MOCK_GL_TRANSACTIONS } from "./general-ledger-data";

const COMPANY_ID = MOCK_COMPANY.id;

export { MOCK_MERCHANTS };

const queueFromBankTransactions: MatchingQueueItem[] = MOCK_TRANSACTIONS.filter((t) => t.allocationStatus === "Suggested" || t.allocationStatus === "Unallocated").map((t) => ({
  id: `BankTransaction:${t.id}`,
  itemType: "BankTransaction",
  description: `${t.description || t.reference || "Bank transaction"} (${t.allocationStatus})`,
  amount: t.debit > 0 ? -t.debit : t.credit,
  date: t.transactionDate,
  confidence: t.confidenceScore,
  detailHref: `/company/${COMPANY_ID}/transactions?transaction=${t.id}`,
}));

const queueFromExceptions: MatchingQueueItem[] = MOCK_BANKING_EXCEPTIONS.filter((e) => e.status === "Open").map((e) => ({
  id: `UnknownMerchant:${e.id}`,
  itemType: e.exceptionType === "PossibleDuplicate" ? "DuplicatePayment" : "UnknownMerchant",
  description: e.reason,
  amount: null,
  date: e.createdAt.slice(0, 10),
  confidence: null,
  detailHref: `/company/${COMPANY_ID}/banking-exceptions`,
}));

const duplicatePaymentSignals = detectDuplicatePayments(MOCK_TRANSACTIONS.map((t) => ({ id: t.id, transactionDate: t.transactionDate, debit: t.debit, credit: t.credit, beneficiary: t.beneficiary })));
const queueFromDuplicatePayments: MatchingQueueItem[] = [...duplicatePaymentSignals.entries()].map(([id, signal]) => ({
  id: `DuplicatePayment:${id}`,
  itemType: "DuplicatePayment",
  description: signal.reasoning,
  amount: null,
  date: null,
  confidence: signal.confidence,
  detailHref: `/company/${COMPANY_ID}/transactions?transaction=${id}`,
}));

export const MOCK_DUPLICATE_CUSTOMER_FINDINGS: AuditTestFinding[] = runDuplicateCustomersTest(MOCK_CUSTOMERS.map((c) => ({ id: c.id, name: c.name, vatNumber: c.vatNumber ?? "", registrationNumber: c.registrationNumber ?? "" })));
export const MOCK_DUPLICATE_SUPPLIER_FINDINGS: AuditTestFinding[] = runDuplicateSuppliersTest(MOCK_SUPPLIERS.map((s) => ({ id: s.id, name: s.name, bankAccountNumber: s.bankAccountNumber ?? "", vatNumber: s.vatNumber ?? "" })));

const queueFromDuplicateParties: MatchingQueueItem[] = [
  ...MOCK_DUPLICATE_CUSTOMER_FINDINGS.map((f): MatchingQueueItem => ({ id: `DuplicateCustomer:${f.relatedId}`, itemType: "DuplicateCustomer", description: f.reason, amount: null, date: null, confidence: f.confidence, detailHref: `/company/${COMPANY_ID}/customers` })),
  ...MOCK_DUPLICATE_SUPPLIER_FINDINGS.map((f): MatchingQueueItem => ({ id: `DuplicateSupplier:${f.relatedId}`, itemType: "DuplicateSupplier", description: f.reason, amount: null, date: null, confidence: f.confidence, detailHref: `/company/${COMPANY_ID}/suppliers` })),
];

const queueFromInvoices: MatchingQueueItem[] = MOCK_SALES_INVOICES.filter((i) => i.status === "Posted" && i.outstanding > 0).map((i) => ({
  id: `UnallocatedInvoice:${i.id}`,
  itemType: "UnallocatedInvoice",
  description: `${i.invoiceNumber} — ${i.outstanding} outstanding`,
  amount: i.outstanding,
  date: i.invoiceDate,
  confidence: null,
  detailHref: `/company/${COMPANY_ID}/sales?tab=invoices`,
}));

const queueFromBills: MatchingQueueItem[] = MOCK_BILLS.filter((b) => b.outstanding > 0).map((b) => ({
  id: `UnallocatedBill:${b.id}`,
  itemType: "UnallocatedBill",
  description: `${b.invoiceNumber} — ${b.outstanding} outstanding`,
  amount: b.outstanding,
  date: b.invoiceDate,
  confidence: null,
  detailHref: `/company/${COMPANY_ID}/purchasing?tab=bills`,
}));

const queueFromCashbook: MatchingQueueItem[] = MOCK_CASHBOOK_TRANSACTIONS.filter((e) => e.captureStatus === "Draft" || e.captureStatus === "Submitted").map((e) => ({
  id: `CashbookEntry:${e.id}`,
  itemType: "CashbookEntry",
  description: `${e.description} (${e.captureStatus})`,
  amount: e.debit > 0 ? -e.debit : e.credit,
  date: e.transactionDate,
  confidence: null,
  detailHref: `/company/${COMPANY_ID}/cashbook?tab=capture`,
}));

export const MOCK_MATCHING_QUEUE: MatchingQueueItem[] = [
  ...queueFromBankTransactions,
  ...queueFromExceptions,
  ...queueFromDuplicatePayments,
  ...queueFromDuplicateParties,
  ...queueFromInvoices,
  ...queueFromBills,
  ...queueFromCashbook,
];

export const MOCK_MATCHING_SUMMARY: MatchingSummary = buildMatchingSummary(MOCK_BANKING_AGGREGATE, MOCK_MATCHING_QUEUE, 82.4, MOCK_BANKING_EXCEPTIONS.filter((e) => e.status === "Open").length);

/** Customer/Supplier Matching workspace mock data — derived via the real
 * pure engines over the SAME mock arrays every prior module already
 * established, same "derived, not hand-typed" discipline as the queue
 * above. */
export const MOCK_CUSTOMER_MATCHING: CustomerMatchingWorkspaceData = {
  invoices: MOCK_SALES_INVOICES.filter((i) => i.documentType === "Invoice"),
  creditNotes: MOCK_SALES_INVOICES.filter((i) => i.documentType === "Credit Note"),
  debitNotes: MOCK_SALES_INVOICES.filter((i) => i.documentType === "Debit Note"),
  receipts: MOCK_CUSTOMER_RECEIPTS,
  candidates: findAllocationCandidates(MOCK_CUSTOMER_RECEIPTS, MOCK_SALES_INVOICES),
};

export const MOCK_SUPPLIER_MATCHING: SupplierMatchingWorkspaceData = {
  bills: MOCK_BILLS.filter((b) => b.documentType === "Bill"),
  creditNotes: MOCK_BILLS.filter((b) => b.documentType === "Credit Note"),
  debitNotes: MOCK_BILLS.filter((b) => b.documentType === "Debit Note"),
  payments: MOCK_SUPPLIER_PAYMENTS,
  candidates: findPaymentAllocationCandidates(MOCK_SUPPLIER_PAYMENTS, MOCK_BILLS),
};

/** Duplicate Detection across all 12 entity types — derived via the SAME
 * pure composition core (`duplicate-detection-engine.ts`) the real
 * service uses, over the SAME mock arrays every prior module already
 * established. */
export const MOCK_DUPLICATE_FINDINGS: DuplicateFinding[] = buildDuplicateFindings(COMPANY_ID, {
  customers: MOCK_CUSTOMERS,
  suppliers: MOCK_SUPPLIERS,
  merchants: MOCK_MERCHANTS,
  stockItems: MOCK_STOCK_ITEMS,
  transactions: MOCK_TRANSACTIONS,
  salesOrders: MOCK_SALES_ORDERS,
  purchaseOrders: MOCK_PURCHASE_ORDERS,
  quotations: MOCK_QUOTATIONS,
  bills: MOCK_BILLS,
  payments: MOCK_SUPPLIER_PAYMENTS,
  receipts: MOCK_CUSTOMER_RECEIPTS,
  glTransactions: MOCK_GL_TRANSACTIONS,
});
