/**
 * Preview Mode seed data for Supplier Reconciliation. Deliberately run
 * through the *real* Matching + Allocation engines (not hand-authored
 * dashboard numbers) so Preview Mode is internally consistent with the
 * actual engine logic — the same guarantee the reference desktop app has
 * by construction, since it has no separate "demo mode" at all. Replace
 * with real Supabase-backed data once a project exists — see
 * ARCHITECTURE.md's "Known Gap" note.
 */

import * as allocationEngine from "@/server/accounting/allocation-engine";
import * as matchingEngine from "@/server/accounting/matching-engine";
import * as shapes from "@/server/accounting/reconciliation-report-shapes";
import type { BankTransactionRecord, ImportedBill, Supplier } from "@/server/accounting/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

const SUPPLIERS: Supplier[] = [
  {
    id: 1, companyId: COMPANY_ID, name: "Fenwick Office Supplies", alternativeNames: ["Fenwick Supplies"], defaultGlAccount: "6100 — Office Supplies", defaultVatCode: "Standard", status: "Active",
    supplierCode: "SUPP-1000", supplierCategory: "Office Supplies", supplierType: "Company", bankName: "FirstRand Bank", bankAccountNumber: "62012345678", bankBranchCode: "250655",
    vatNumber: "4123456780", taxNumber: "9012345678", riskRating: "Low", paymentTermsDays: 30,
  },
  {
    id: 2, companyId: COMPANY_ID, name: "Netherfield Freight Ltd", alternativeNames: [], defaultGlAccount: "6200 — Distribution", defaultVatCode: "Standard", status: "Active",
    supplierCode: "SUPP-1001", supplierCategory: "Logistics", supplierType: "Company", bankName: "Standard Bank", bankAccountNumber: "011223344", bankBranchCode: "051001",
    vatNumber: "4198765430", taxNumber: "9087654321", riskRating: "Medium", paymentTermsDays: 30,
  },
  {
    id: 3, companyId: COMPANY_ID, name: "Harrow Print & Design", alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active",
    supplierCode: "SUPP-1002", supplierCategory: "Marketing", supplierType: "Individual", bankName: "", bankAccountNumber: "", bankBranchCode: "",
    vatNumber: "", taxNumber: "", riskRating: "Low", paymentTermsDays: 14,
  },
];

/** Every mock bill here arrived via (simulated) import, never through the
 * new Purchasing workflow — `origin: "Imported"` and a null
 * `postingStatus` are the honest, real values for that, not placeholders. */
const IMPORTED_BILL_DEFAULTS = {
  origin: "Imported" as const,
  purchaseOrderId: null,
  goodsReceivedNoteId: null,
  postingStatus: null,
  journalId: null,
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  postedAt: null,
  cancelledBy: null,
  cancelledAt: null,
};

const BILLS: ImportedBill[] = [
  { id: 1, companyId: COMPANY_ID, supplierId: 1, supplierName: "Fenwick Office Supplies", invoiceNumber: "INV-3381", documentType: "Bill", invoiceDate: "2026-06-02", dueDate: "2026-07-02", vat: 87.5, total: 612.5, outstanding: 612.5, status: "Open", glAccount: null, vatCode: null, ...IMPORTED_BILL_DEFAULTS },
  { id: 2, companyId: COMPANY_ID, supplierId: 2, supplierName: "Netherfield Freight Ltd", invoiceNumber: "NF-9042", documentType: "Bill", invoiceDate: "2026-06-10", dueDate: "2026-07-10", vat: 210, total: 1470, outstanding: 1470, status: "Open", glAccount: "6200 — Distribution", vatCode: "Standard", ...IMPORTED_BILL_DEFAULTS },
  { id: 3, companyId: COMPANY_ID, supplierId: 3, supplierName: "Harrow Print & Design", invoiceNumber: "HP-118", documentType: "Bill", invoiceDate: "2026-06-15", dueDate: "2026-07-15", vat: 42, total: 294, outstanding: 294, status: "Open", glAccount: null, vatCode: null, ...IMPORTED_BILL_DEFAULTS },
  { id: 4, companyId: COMPANY_ID, supplierId: 1, supplierName: "Fenwick Office Supplies", invoiceNumber: "INV-3402", documentType: "Credit Note", invoiceDate: "2026-06-20", dueDate: null, vat: -12.5, total: -87.5, outstanding: -87.5, status: "Open", glAccount: null, vatCode: null, ...IMPORTED_BILL_DEFAULTS },
];

const RAW_TRANSACTIONS: BankTransactionRecord[] = [
  base(1, { beneficiary: "Fenwick Office Supplies", debit: 612.5, description: "Payment INV-3381", transactionDate: "2026-07-01" }),
  base(2, { beneficiary: "Netherfield Freight Ltd", debit: 1470, description: "June freight", transactionDate: "2026-07-08" }),
  base(3, { beneficiary: "Harrow Print & Design", debit: 150, description: "Part payment HP-118", transactionDate: "2026-07-16" }),
  base(4, { beneficiary: "Unregistered Cleaning Co", debit: 240, description: "Monthly cleaning", transactionDate: "2026-07-05" }),
  base(5, { beneficiary: "Netherfield Freight Ltd", debit: 1470, description: "June freight", transactionDate: "2026-07-09" }),
  base(6, { beneficiary: "Fenwick Office Supplies", debit: 0, credit: 87.5, description: "Refund", transactionDate: "2026-07-03" }),
];

function base(id: number, overrides: Partial<BankTransactionRecord>): BankTransactionRecord {
  return {
    id,
    companyId: COMPANY_ID,
    transactionDate: null,
    reference: "",
    description: "",
    beneficiary: "",
    debit: 0,
    credit: 0,
    balance: null,
    bankAccount: "Main Current Account",
    bankAccountId: null,
    glAccount: "",
    vat: null,
    notes: "",
    importBatch: "",
    sourceFilename: "",
    createdAt: "2026-07-01T00:00:00Z",
    allocationStatus: "Unallocated",
    matchedSupplierId: null,
    matchedSupplierName: null,
    matchedBillId: null,
    confidenceScore: null,
    rulesTriggered: [],
    matchReason: "",
    requiredAction: null,
    suggestedGlAccount: null,
    suggestedVatCode: null,
    allocationMethod: null,
    allocationReason: "",
    isManualOverride: false,
    reviewStatus: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    journalId: null,
    matchedCustomerId: null,
    matchedMerchantId: null,
    ruleId: null,
    allocationType: null,
    allocationNotes: "",
    entrySource: "Imported",
    captureStatus: null,
    cashbookBatchId: null,
    reconciliationId: null,
    reversalOfTransactionId: null,
    isSplit: false,
    ...overrides,
  };
}

function computeMockTransactions(): BankTransactionRecord[] {
  const matchResults = matchingEngine.evaluateBatch(
    COMPANY_ID,
    RAW_TRANSACTIONS.filter((t) => t.debit > 0),
    SUPPLIERS,
    BILLS,
  );
  const matchByTxnId = new Map(matchResults.map((r) => [r.bankTransactionId, r]));

  const afterMatching = RAW_TRANSACTIONS.map((t) => {
    const match = matchByTxnId.get(t.id);
    if (!match) return t;
    return {
      ...t,
      allocationStatus: match.status === "Unmatched" ? ("Unallocated" as const) : match.status,
      matchedSupplierId: match.matchedSupplierId,
      matchedBillId: match.matchedBillId,
      confidenceScore: match.confidence,
      rulesTriggered: match.rulesTriggered,
      matchReason: match.reason,
      requiredAction: match.requiredAction,
    };
  });

  const allocationResults = allocationEngine.evaluateBatch(COMPANY_ID, afterMatching, SUPPLIERS, BILLS);
  const allocationByTxnId = new Map(allocationResults.map((r) => [r.bankTransactionId, r]));

  return afterMatching.map((t) => {
    const allocation = allocationByTxnId.get(t.id);
    if (!allocation) return t;
    return {
      ...t,
      allocationStatus: allocation.status,
      suggestedGlAccount: allocation.glAccount,
      suggestedVatCode: allocation.vatCode,
      allocationMethod: allocation.allocationMethod,
      allocationReason: allocation.allocationReason,
      requiredAction: allocation.requiredAction,
    };
  });
}

export const MOCK_SUPPLIERS = SUPPLIERS;
export const MOCK_BILLS = BILLS;
export const MOCK_TRANSACTIONS = computeMockTransactions();
const MOCK_OPEN_BILLS = BILLS.filter((b) => b.outstanding > 0.01);
const MOCK_OUTSTANDING_WORK_ITEMS = MOCK_TRANSACTIONS.filter(
  (t) => t.allocationStatus === "Suggested" || t.allocationStatus === "Unallocated",
).length;

export function mockDashboardCounts() {
  return shapes.shapeDashboardCounts(BILLS, MOCK_TRANSACTIONS, MOCK_OUTSTANDING_WORK_ITEMS);
}

export const MOCK_REPORTS = {
  "supplier-allocation": shapes.shapeSupplierAllocationRows(MOCK_TRANSACTIONS, SUPPLIERS, BILLS),
  "supplier-payment": shapes.shapeSupplierPaymentRows(MOCK_TRANSACTIONS, SUPPLIERS),
  "outstanding-suppliers": shapes.shapeOutstandingSuppliersRows(MOCK_OPEN_BILLS),
  "unknown-payments": shapes.shapeUnknownPaymentsRows(MOCK_TRANSACTIONS),
  "duplicate-payments": shapes.shapeDuplicatePaymentsRows(MOCK_TRANSACTIONS, BILLS),
} as const;
