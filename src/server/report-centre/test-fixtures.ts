/**
 * A small but complete, fully coherent set of books for testing the
 * Reporting Centre: every document has its real journal and GL lines,
 * exactly as VYRON's posting engines write them, so every reconciliation
 * a report makes (subsidiary ledger ↔ control account, VAT sources ↔ VAT
 * accounts, bank records ↔ bank GL, P&L ↔ GL lines, TB balanced) must
 * hold — and the expected figures below are worked out by hand.
 *
 * Financial year 2026/27 (1 Mar 2026 – 28 Feb 2027); "today" = 31 Jul 2026.
 *
 *  J1  01 Mar  Opening balances   Dr Bank 10,000  Dr Debtors 1,150 (Acme)  Cr Creditors 575 (Northline)  Cr Retained 10,575
 *  J2  10 Apr  INV001 Acme        Dr Debtors 1,150   Cr Sales 1,000   Cr VAT Output 150
 *  J7  15 Apr  Bill NL-100        Dr Purchases 1,000 Dr VAT Input 150  Cr Creditors 1,150
 *  J3  05 May  INV002 Bayside     Dr Debtors 2,300   Cr Sales 2,000   Cr VAT Output 300
 *  J5  15 May  RCPT001 Acme       Dr Bank 1,150      Cr Debtors 1,150 (allocated to INV001)
 *  J4  20 May  CN001 Acme         Dr Sales 200       Dr VAT Output 30  Cr Debtors 230 (unapplied)
 *  J8  20 May  PAY001 Northline   Dr Creditors 575   Cr Bank 575 (allocated to NL-100)
 *  J6  10 Jun  Bank T101 (type C, Bayside, reconciled)   Dr Bank 1,000  Cr Debtors 1,000
 *  J9  20 Jun  Bank T102 (type S, Northline)             Dr Creditors 575  Cr Bank 575
 *  J10 25 Jun  Bank T103 (GL 6100, VAT 15)               Dr Bank Charges 100  Dr VAT Control 15  Cr Bank 115
 *  J11 30 Jun  Bank T104 (GL 6200)                       Dr Bank 50  Cr Interest 50
 *  J12 15 Jul  Draft manual journal (never posted)
 *  T105 Ready to Post (rent 300), T106/T107 Unprocessed look-alike deposits of 200.
 */

import { VAT_TYPES } from "@/server/company-management/types";
import type { ChartOfAccount, GlTransactionWithContext } from "@/server/general-ledger/types";
import type { BankAccount, BankTransactionRecord, ImportedBill, Journal, PurchaseBillLine, Supplier } from "@/server/accounting/types";
import type { Customer } from "@/server/customer-management/types";
import type { CustomerReceipt, SalesInvoice, SalesInvoiceLine } from "@/server/sales/types";
import type { SupplierPayment } from "@/server/purchasing/types";
import type { FinancialYear, VatTreatment } from "@/server/company-management/types";
import type { BankReconciliation } from "@/server/banking/types";
import type { OpeningBalanceEntry } from "@/server/opening-balances/types";
import type { StockItem } from "@/server/inventory/types";
import type { Budget } from "@/server/reporting/types";
import { resolveVatAccounts } from "./control-accounts";
import { createInMemorySource, type InMemoryData, type ReportDataSource } from "./source";

export const COMPANY_ID = "test-co";
export const TODAY = "2026-07-31";

const account = (id: number, accountCode: string, description: string, accountType: ChartOfAccount["accountType"], normalBalance: ChartOfAccount["normalBalance"], category: string, isControlAccount = false): ChartOfAccount => ({
  id, companyId: COMPANY_ID, accountCode, description, accountType, category, normalBalance, parentAccountId: null, reportingGroup: "", financialStatementGroup: "", taxTreatment: "",
  branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount, isActive: true, notes: "", createdAt: "2026-01-01T00:00:00Z",
});

export const ACCOUNTS: ChartOfAccount[] = [
  account(1, "1000", "Bank", "Asset", "Debit", "Current Asset"),
  account(2, "1100", "Debtors", "Asset", "Debit", "Current Asset", true),
  account(3, "2000", "Creditors", "Liability", "Credit", "Current Liability", true),
  account(4, "2100", "VAT Input", "Asset", "Debit", "Current Asset"),
  account(5, "2200", "VAT Output", "Liability", "Credit", "Current Liability"),
  account(6, "2300", "VAT Control", "Liability", "Credit", "Current Liability"),
  account(7, "3000", "Retained Income", "Equity", "Credit", "Equity"),
  account(8, "4000", "Sales", "Income", "Credit", "Sales"),
  account(9, "5000", "Purchases", "Cost of Sales", "Debit", "Purchases"),
  account(10, "6100", "Bank Charges", "Expense", "Debit", "Bank Charges"),
  account(11, "6200", "Interest Received", "Other Income", "Credit", "Interest"),
  account(12, "6300", "Rent", "Expense", "Debit", "Premises"),
];

const byCode = new Map(ACCOUNTS.map((a) => [a.accountCode, a]));

type JournalSpec = { id: number; date: string; sourceType: string; sourceId?: number | null; status?: Journal["status"]; description: string; lines: [string, number, number][] };

const JOURNAL_SPECS: JournalSpec[] = [
  { id: 1, date: "2026-03-01", sourceType: "OpeningBalance", description: "Opening balances", lines: [["1000", 10000, 0], ["1100", 1150, 0], ["2000", 0, 575], ["3000", 0, 10575]] },
  { id: 2, date: "2026-04-10", sourceType: "sales_invoice", sourceId: 1, description: "INV001", lines: [["1100", 1150, 0], ["4000", 0, 1000], ["2200", 0, 150]] },
  { id: 3, date: "2026-05-05", sourceType: "sales_invoice", sourceId: 2, description: "INV002", lines: [["1100", 2300, 0], ["4000", 0, 2000], ["2200", 0, 300]] },
  { id: 4, date: "2026-05-20", sourceType: "sales_invoice", sourceId: 3, description: "CN001", lines: [["4000", 200, 0], ["2200", 30, 0], ["1100", 0, 230]] },
  { id: 5, date: "2026-05-15", sourceType: "customer_receipt", sourceId: 1, description: "RCPT001", lines: [["1000", 1150, 0], ["1100", 0, 1150]] },
  { id: 6, date: "2026-06-10", sourceType: "bank_transactions_bulk", description: "Bank posting", lines: [["1000", 1000, 0], ["1100", 0, 1000]] },
  { id: 7, date: "2026-04-15", sourceType: "purchase_bill", sourceId: 1, description: "NL-100", lines: [["5000", 1000, 0], ["2100", 150, 0], ["2000", 0, 1150]] },
  { id: 8, date: "2026-05-20", sourceType: "supplier_payment", sourceId: 1, description: "PAY001", lines: [["2000", 575, 0], ["1000", 0, 575]] },
  { id: 9, date: "2026-06-20", sourceType: "bank_transactions_bulk", description: "Bank posting", lines: [["2000", 575, 0], ["1000", 0, 575]] },
  { id: 10, date: "2026-06-25", sourceType: "bank_transactions_bulk", description: "Bank posting", lines: [["6100", 100, 0], ["2300", 15, 0], ["1000", 0, 115]] },
  { id: 11, date: "2026-06-30", sourceType: "bank_transactions_bulk", description: "Bank posting", lines: [["1000", 50, 0], ["6200", 0, 50]] },
  { id: 12, date: "2026-07-15", sourceType: "manual", status: "Draft", description: "Rent accrual (draft)", lines: [["6300", 300, 0], ["1000", 0, 300]] },
];

let lineId = 0;
let glId = 0;
export const JOURNALS: Journal[] = [];
export const GL: GlTransactionWithContext[] = [];
for (const spec of JOURNAL_SPECS) {
  const status = spec.status ?? "Posted";
  const lines = spec.lines.map(([code, debit, credit], i) => ({ id: ++lineId, journalId: spec.id, accountCode: code, debit, credit, description: spec.description, lineOrder: i }));
  JOURNALS.push({
    id: spec.id, companyId: COMPANY_ID, journalNumber: `JR${String(spec.id).padStart(6, "0")}`, journalDate: spec.date, journalType: spec.sourceType, description: spec.description, reference: "",
    sourceType: spec.sourceType, sourceId: spec.sourceId ?? null, status, totalDebit: lines.reduce((s, l) => s + l.debit, 0), totalCredit: lines.reduce((s, l) => s + l.credit, 0),
    createdAt: `${spec.date}T08:00:00Z`, postedAt: status === "Posted" ? `${spec.date}T09:00:00Z` : null, submittedBy: null, submittedAt: null, approvedBy: status === "Posted" ? "controller@test.co" : null,
    approvedAt: status === "Posted" ? `${spec.date}T08:30:00Z` : null, rejectedBy: null, rejectedAt: null, cancelledBy: null, cancelledAt: null, isReversed: false, reversalOfJournalId: null,
    reversedByJournalId: null, postingBatchId: status === "Posted" ? spec.id : null, lines,
  });
  if (status !== "Posted") continue;
  for (const l of lines) {
    const a = byCode.get(l.accountCode)!;
    GL.push({
      id: ++glId, companyId: COMPANY_ID, journalId: spec.id, journalLineId: l.id, accountId: a.id, postingDate: spec.date, reference: spec.description, description: spec.description,
      debit: l.debit, credit: l.credit, financialYearLabel: "2026/27", financialPeriod: 1, postedAt: `${spec.date}T09:00:00Z`, postedBy: "System",
      accountCode: a.accountCode, accountDescription: a.description, journalNumber: `JR${String(spec.id).padStart(6, "0")}`, sourceType: spec.sourceType,
    });
  }
}

const customer = (id: number, code: string, name: string, creditLimit: number): Customer => ({
  id, companyId: COMPANY_ID, customerCode: code, name, customerType: "Company", customerGroup: "", industry: "", vatNumber: "", registrationNumber: "", creditLimit, paymentTermsDays: 30,
  currencyCode: "ZAR", priceList: "", salesRep: "", isActive: true, riskRating: "Low", notes: "", createdAt: "2026-01-01T00:00:00Z",
});
export const CUSTOMERS: Customer[] = [customer(1, "C001", "Acme Retail", 5000), customer(2, "C002", "Bayside Clinic", 2000)];

const supplier = (id: number, code: string, name: string, vatNumber: string): Supplier => ({
  id, companyId: COMPANY_ID, name, alternativeNames: [], defaultGlAccount: null, defaultVatCode: null, status: "Active", supplierCode: code, supplierCategory: "", supplierType: "Company" as Supplier["supplierType"],
  bankName: "", bankAccountNumber: "", bankBranchCode: "", vatNumber, taxNumber: "", riskRating: "Low" as Supplier["riskRating"], paymentTermsDays: 30, spendingLimit: 0,
});
export const SUPPLIERS: Supplier[] = [supplier(1, "S001", "Northline Supplies", "4000000001"), supplier(2, "S002", "Nova Freight", "")];

const line = (id: number, invoiceId: number, description: string, quantity: number, unitPrice: number, netAmount: number, vatAmount: number, stockItemId: number | null = null): SalesInvoiceLine => ({
  id, invoiceId, lineOrder: id, description, quantity, unitPrice, lineTotal: netAmount, stockItemId, glAccount: null, vatCode: null, discount: 0, netAmount, vatAmount,
});
const invoice = (o: Pick<SalesInvoice, "id" | "customerId" | "invoiceNumber" | "documentType" | "invoiceDate" | "dueDate" | "status" | "journalId" | "subtotal" | "vatAmount" | "total" | "outstanding" | "lines">): SalesInvoice => ({
  companyId: COMPANY_ID, orderId: null, deliveryId: null, vatTreatmentCode: "Standard", isRecurringTemplate: false, recurrencePattern: "", reference: "", notes: "", createdAt: `${o.invoiceDate}T08:00:00Z`,
  submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, postedAt: o.status === "Posted" ? `${o.invoiceDate}T09:00:00Z` : null, cancelledBy: null, cancelledAt: null, originalInvoiceId: null, ...o,
});
export const INVOICES: SalesInvoice[] = [
  invoice({ id: 1, customerId: 1, invoiceNumber: "INV001", documentType: "Invoice", invoiceDate: "2026-04-10", dueDate: "2026-05-10", status: "Posted", journalId: 2, subtotal: 1000, vatAmount: 150, total: 1150, outstanding: 0, lines: [line(1, 1, "Consulting", 1, 600, 600, 90), line(2, 1, "Widget", 2, 200, 400, 60, 1)] }),
  invoice({ id: 2, customerId: 2, invoiceNumber: "INV002", documentType: "Invoice", invoiceDate: "2026-05-05", dueDate: "2026-06-04", status: "Posted", journalId: 3, subtotal: 2000, vatAmount: 300, total: 2300, outstanding: 2300, lines: [line(3, 2, "Widget", 10, 200, 2000, 300, 1)] }),
  invoice({ id: 3, customerId: 1, invoiceNumber: "CN001", documentType: "Credit Note", invoiceDate: "2026-05-20", dueDate: null, status: "Posted", journalId: 4, subtotal: 200, vatAmount: 30, total: 230, outstanding: 230, lines: [line(4, 3, "Consulting", 1, 200, 200, 30)] }),
  invoice({ id: 4, customerId: 2, invoiceNumber: "INV003", documentType: "Invoice", invoiceDate: "2026-07-20", dueDate: "2026-08-19", status: "Draft", journalId: null, subtotal: 500, vatAmount: 75, total: 575, outstanding: 575, lines: [line(5, 4, "Widget", 2.5, 200, 500, 75, 1)] }),
];

export const RECEIPTS: CustomerReceipt[] = [
  {
    id: 1, companyId: COMPANY_ID, customerId: 1, bankAccountId: 1, receiptNumber: "RCPT001", receiptDate: "2026-05-15", amount: 1150, status: "Posted", journalId: 5, reference: "", notes: "",
    createdAt: "2026-05-15T08:00:00Z", approvedBy: null, approvedAt: null, postedAt: "2026-05-15T09:00:00Z", allocations: [{ id: 1, receiptId: 1, invoiceId: 1, amountAllocated: 1150, createdAt: "2026-05-15T09:00:00Z" }],
  },
];

const bill = (o: Pick<ImportedBill, "id" | "supplierId" | "supplierName" | "invoiceNumber" | "invoiceDate" | "dueDate" | "vat" | "total" | "outstanding" | "glAccount" | "postingStatus" | "journalId" | "origin">): ImportedBill => ({
  companyId: COMPANY_ID, documentType: "Bill", currency: "ZAR", status: "Open", vatCode: "Standard", purchaseOrderId: null, goodsReceivedNoteId: null, submittedBy: null, submittedAt: null,
  approvedBy: null, approvedAt: null, postedAt: null, cancelledBy: null, cancelledAt: null, ...o,
});
export const BILLS: ImportedBill[] = [
  bill({ id: 1, supplierId: 1, supplierName: "Northline Supplies", invoiceNumber: "NL-100", invoiceDate: "2026-04-15", dueDate: "2026-05-15", vat: 150, total: 1150, outstanding: 575, glAccount: "5000", postingStatus: "Posted", journalId: 7, origin: "Purchasing" as ImportedBill["origin"] }),
  bill({ id: 2, supplierId: 2, supplierName: "Nova Freight", invoiceNumber: "NF-7", invoiceDate: "2026-07-05", dueDate: "2026-08-04", vat: 30, total: 230, outstanding: 230, glAccount: "5000", postingStatus: null, journalId: null, origin: "Import" as ImportedBill["origin"] }),
];

export const BILL_LINES: PurchaseBillLine[] = [
  { id: 1, companyId: COMPANY_ID, billId: 1, lineOrder: 0, description: "Stock purchase", glAccount: "5000", vatCode: "Standard", costCentreId: null, projectId: null, departmentId: null, quantity: 5, unitCost: 200, discount: 0, netAmount: 1000, vatAmount: 150, lineTotal: 1150, createdAt: "2026-04-15T08:00:00Z" },
];

export const PAYMENTS: SupplierPayment[] = [
  {
    id: 1, companyId: COMPANY_ID, supplierId: 1, bankAccountId: 1, paymentNumber: "PAY001", paymentDate: "2026-05-20", amount: 575, status: "Posted", journalId: 8, reference: "", notes: "",
    createdAt: "2026-05-20T08:00:00Z", approvedBy: null, approvedAt: null, postedAt: "2026-05-20T09:00:00Z", allocations: [{ id: 1, paymentId: 1, billId: 1, amountAllocated: 575, createdAt: "2026-05-20T09:00:00Z" }],
  },
];

const ob = (id: number, o: Pick<OpeningBalanceEntry, "category" | "amount"> & Partial<OpeningBalanceEntry>): OpeningBalanceEntry => ({
  id, companyId: COMPANY_ID, accountCode: null, bankAccountId: null, customerId: null, supplierId: null, description: "Opening balance", reference: "", balanceDate: "2026-03-01", status: "posted",
  journalId: 1, createdBy: "setup@test.co", createdAt: "2026-03-01T07:00:00Z", updatedAt: "2026-03-01T07:00:00Z", ...o,
});
export const OPENING_BALANCES: OpeningBalanceEntry[] = [
  ob(1, { category: "Customer", customerId: 1, amount: 1150 }),
  // A positive entry debits the control account, so a supplier's credit
  // balance of 575 is captured as −575 (opening-balance-service.ts).
  ob(2, { category: "Supplier", supplierId: 1, amount: -575 }),
  ob(3, { category: "BankAccount", bankAccountId: 1, amount: 10000 }),
  ob(4, { category: "GeneralLedger", accountCode: "3000", amount: -10575 }),
];

export const BANK_ACCOUNTS: BankAccount[] = [
  { id: 1, companyId: COMPANY_ID, accountNumber: "62000000001", accountName: "Business Cheque", bankName: "FNB", accountType: "Cheque", branch: "", currency: "ZAR", status: "Active" as BankAccount["status"], openingBalance: 10000, currentBalance: 0, lastReconciliationDate: "2026-06-30", notes: "", createdAt: null, glAccount: "1000", openingBalanceDate: "2026-03-01", openingBalanceReference: "" },
];

const txn = (o: Partial<BankTransactionRecord> & Pick<BankTransactionRecord, "id" | "transactionDate" | "description">): BankTransactionRecord => ({
  companyId: COMPANY_ID, reference: "", beneficiary: "", debit: 0, credit: 0, balance: null, bankAccount: "62000000001", bankAccountId: 1, glAccount: "", vat: null, notes: "", importBatch: "BATCH-1",
  sourceFilename: "statement.csv", createdAt: "2026-07-01T10:00:00Z", allocationStatus: "Unallocated", matchedSupplierId: null, matchedSupplierName: null, matchedBillId: null, confidenceScore: null,
  rulesTriggered: [], matchReason: "", requiredAction: null, suggestedGlAccount: null, suggestedVatCode: null, allocationMethod: null, allocationReason: "", isManualOverride: false, reviewStatus: null,
  reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null, ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported",
  captureStatus: null, cashbookBatchId: null, reconciliationId: null, reversalOfTransactionId: null, isSplit: false, postedFlag: false, postedAt: null, postingBatchId: null, sourceOccurrence: 1,
  reviewHold: false, reviewHoldReason: "", reviewHoldBy: null, reviewHoldAt: null, overrideSupplierInvoiceMatching: false, overrideSupplierInvoiceMatchingBy: null, overrideSupplierInvoiceMatchingAt: null, ...o,
});
export const BANK_TRANSACTIONS: BankTransactionRecord[] = [
  txn({ id: 101, transactionDate: "2026-06-10", description: "Bayside Clinic payment", credit: 1000, allocationType: "C", matchedCustomerId: 2, postedFlag: true, postedAt: "2026-06-11T09:00:00Z", journalId: 6, reconciliationId: 1 }),
  txn({ id: 102, transactionDate: "2026-06-20", description: "Northline EFT", debit: 575, allocationType: "S", matchedSupplierId: 1, matchedBillId: 1, postedFlag: true, postedAt: "2026-06-21T09:00:00Z", journalId: 9 }),
  txn({ id: 103, transactionDate: "2026-06-25", description: "Service fees", debit: 115, vat: 15, suggestedGlAccount: "6100", suggestedVatCode: "Standard", allocationType: "G", postedFlag: true, postedAt: "2026-06-26T09:00:00Z", journalId: 10 }),
  txn({ id: 104, transactionDate: "2026-06-30", description: "Interest", credit: 50, suggestedGlAccount: "6200", allocationType: "G", postedFlag: true, postedAt: "2026-07-01T09:00:00Z", journalId: 11 }),
  txn({ id: 105, transactionDate: "2026-07-01", description: "Rent July", debit: 300, suggestedGlAccount: "6300", allocationType: "G" }),
  txn({ id: 106, transactionDate: "2026-07-02", description: "Unknown deposit", credit: 200 }),
  txn({ id: 107, transactionDate: "2026-07-02", description: "Unknown deposit", credit: 200, sourceOccurrence: 2 }),
];

export const RECONCILIATIONS: BankReconciliation[] = [
  {
    id: 1, companyId: COMPANY_ID, bankAccountId: 1, statementDate: "2026-06-30", statementPeriodStart: "2026-06-01", statementOpeningBalance: 10575, statementClosingBalance: 11575,
    glClosingBalance: null, difference: null, status: "Completed" as BankReconciliation["status"], monthEndLocked: false, notes: "", createdBy: "controller@test.co", createdAt: "2026-07-02T08:00:00Z",
    completedBy: "controller@test.co", completedAt: "2026-07-02T09:00:00Z", reopenedBy: null, reopenedAt: null,
  } as BankReconciliation,
];

export const FINANCIAL_YEARS: FinancialYear[] = [
  { id: 1, companyId: COMPANY_ID, yearLabel: "2026/27", startDate: "2026-03-01", endDate: "2027-02-28", status: "Open" as FinancialYear["status"], isCurrent: true, createdAt: "2026-01-01T00:00:00Z" } as FinancialYear,
];

export const VAT_TREATMENTS: VatTreatment[] = [{ id: 1, companyId: COMPANY_ID, code: "Standard", name: "Standard Rated", rate: 15, vatType: VAT_TYPES[0], isActive: true, createdAt: "2026-01-01T00:00:00Z" }];

export const STOCK_ITEMS: StockItem[] = [{ id: 1, companyId: COMPANY_ID, stockCode: "W-1", description: "Widget", category: "Hardware", averageCost: 120, costPrice: 120, quantityOnHand: 50, reorderLevel: 10, unitOfMeasure: "each", status: "Active" } as StockItem];

export const BUDGETS: Budget[] = [
  { id: 1, companyId: COMPANY_ID, accountId: 8, financialYearLabel: "2026/27", branchId: null, departmentId: null, costCentreId: null, projectId: null, amount: 10000, createdBy: "", createdAt: "", updatedAt: "" },
  { id: 2, companyId: COMPANY_ID, accountId: 10, financialYearLabel: "2026/27", branchId: null, departmentId: null, costCentreId: null, projectId: null, amount: 500, createdBy: "", createdAt: "", updatedAt: "" },
];

export function fixtureData(): InMemoryData {
  return {
    company: { id: COMPANY_ID, name: "Test Co (Pty) Ltd", financialYearStartMonth: 3, currencyCode: "ZAR" },
    financialYears: FINANCIAL_YEARS,
    accounts: ACCOUNTS,
    controlAccounts: { debtors: "1100", creditors: "2000", vat: resolveVatAccounts(ACCOUNTS) },
    gl: GL,
    journals: JOURNALS,
    customers: CUSTOMERS,
    suppliers: SUPPLIERS,
    salesInvoices: INVOICES,
    customerReceipts: RECEIPTS,
    bills: BILLS,
    billLines: BILL_LINES,
    supplierPayments: PAYMENTS,
    bankAccounts: BANK_ACCOUNTS,
    bankTransactions: BANK_TRANSACTIONS,
    bankReconciliations: RECONCILIATIONS,
    openingBalances: OPENING_BALANCES,
    vatTreatments: VAT_TREATMENTS,
    stockItems: STOCK_ITEMS,
    budgets: BUDGETS,
  };
}

export function fixtureSource(overrides: Partial<InMemoryData> = {}): ReportDataSource {
  return createInMemorySource({ ...fixtureData(), ...overrides });
}
