/**
 * Preview Mode seed data for the General Ledger & Accounting Engine
 * (Module 10). Field shapes match the real domain types exactly. Derived
 * figures (Trial Balance rows/totals, Account Activity's monthly trend,
 * the Financial Intelligence report) are computed from the same
 * mock journals/postings via the real production functions — not
 * hand-typed — the same internal-consistency discipline
 * `transaction-explorer-data.ts`'s `MOCK_TRANSACTION_SUMMARY` already
 * established for this app.
 */

import type { Journal, JournalLine } from "@/server/accounting/types";
import type {
  AccountActivity,
  ChartOfAccount,
  GlTransaction,
  GlTransactionWithContext,
  PostingRule,
  TrialBalance,
} from "@/server/general-ledger/types";
import { computeFinancialPeriod, computeFinancialYearLabel } from "@/server/services/financial-year-service";
import { buildMonthlyTrend, computeVariance, type AccountYearComparison } from "@/server/services/account-activity-service";
import {
  aggregateMovementsByAccount,
  findLargestMovements,
  findMissingPostings,
  findPossibleDuplicateJournals,
  findUnusualGrowth,
  type FinancialIntelligenceReport,
} from "@/server/services/financial-intelligence-service";
import { trialBalanceRowFromRpcRow, type TrialBalanceRpcRow } from "@/server/general-ledger/mappers";
import { summarizeTrialBalance } from "@/server/services/trial-balance-service";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;
const START_MONTH = 3; // South African tax year default, matching MOCK_COMPANIES_FULL's co_2 entry.

// ---------------------------------------------------------------------
// Chart of Accounts — the reference's exact 11 default accounts plus
// Suspense (seeded 1:1 by `seed_company_defaults()`), plus two extra
// child accounts to demonstrate tree nesting (a genuinely new capability
// with no reference-app equivalent).
// ---------------------------------------------------------------------

export const MOCK_CHART_OF_ACCOUNTS: ChartOfAccount[] = [
  { id: 1, companyId: COMPANY_ID, accountCode: "1000", description: "Bank", accountType: "Asset", category: "Current Asset", normalBalance: "Debit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Balance Sheet", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 2, companyId: COMPANY_ID, accountCode: "1100", description: "Debtors", accountType: "Asset", category: "Current Asset", normalBalance: "Debit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Balance Sheet", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: true, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 3, companyId: COMPANY_ID, accountCode: "2000", description: "Creditors", accountType: "Liability", category: "Current Liability", normalBalance: "Credit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Balance Sheet", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: true, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 4, companyId: COMPANY_ID, accountCode: "2100", description: "VAT Input", accountType: "Asset", category: "Current Asset", normalBalance: "Debit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Balance Sheet", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 5, companyId: COMPANY_ID, accountCode: "2200", description: "VAT Output", accountType: "Liability", category: "Current Liability", normalBalance: "Credit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Balance Sheet", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 6, companyId: COMPANY_ID, accountCode: "3000", description: "Retained Income", accountType: "Equity", category: "Equity", normalBalance: "Credit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Balance Sheet", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 7, companyId: COMPANY_ID, accountCode: "4000", description: "Sales", accountType: "Income", category: "Operating Income", normalBalance: "Credit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Income Statement", taxTreatment: "Standard Rated", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 8, companyId: COMPANY_ID, accountCode: "4100", description: "Sales Returns", accountType: "Income", category: "Operating Income", normalBalance: "Debit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Income Statement", taxTreatment: "Standard Rated", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 9, companyId: COMPANY_ID, accountCode: "5000", description: "Purchases", accountType: "Cost of Sales", category: "Cost of Sales", normalBalance: "Debit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Income Statement", taxTreatment: "Standard Rated", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 10, companyId: COMPANY_ID, accountCode: "6100", description: "Bank Charges", accountType: "Expense", category: "Operating Expense", normalBalance: "Debit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Income Statement", taxTreatment: "No VAT", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 11, companyId: COMPANY_ID, accountCode: "6200", description: "Interest Received", accountType: "Other Income", category: "Other Income", normalBalance: "Credit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Income Statement", taxTreatment: "No VAT", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 12, companyId: COMPANY_ID, accountCode: "9999", description: "Suspense", accountType: "Equity", category: "Suspense", normalBalance: "Debit", parentAccountId: null, reportingGroup: "", financialStatementGroup: "Balance Sheet", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-01-14T09:00:00Z" },
  { id: 13, companyId: COMPANY_ID, accountCode: "5010", description: "Freight In", accountType: "Cost of Sales", category: "Cost of Sales", normalBalance: "Debit", parentAccountId: 9, reportingGroup: "", financialStatementGroup: "Income Statement", taxTreatment: "Standard Rated", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-02-01T09:00:00Z" },
  { id: 14, companyId: COMPANY_ID, accountCode: "1001", description: "Bank — Cheque Account", accountType: "Asset", category: "Current Asset", normalBalance: "Debit", parentAccountId: 1, reportingGroup: "", financialStatementGroup: "Balance Sheet", taxTreatment: "", branchId: null, departmentId: null, costCentreId: null, projectId: null, isControlAccount: false, isActive: true, notes: "", createdAt: "2025-02-01T09:00:00Z" },
];

// ---------------------------------------------------------------------
// Posting Rules — the same 8 event types seeded by `seed_company_defaults()`.
// ---------------------------------------------------------------------

export const MOCK_POSTING_RULES: PostingRule[] = [
  {
    id: 1, companyId: COMPANY_ID, eventType: "Sales Invoice", description: "Customer sales invoice", isActive: true, createdAt: "2025-01-14T09:00:00Z",
    lines: [
      { id: 1, postingRuleId: 1, lineOrder: 0, side: "Debit", role: "debtors", fixedAccountCode: "1100", amountSource: "gross" },
      { id: 2, postingRuleId: 1, lineOrder: 1, side: "Credit", role: "sales", fixedAccountCode: "4000", amountSource: "net" },
      { id: 3, postingRuleId: 1, lineOrder: 2, side: "Credit", role: "vat_output", fixedAccountCode: "2200", amountSource: "vat" },
    ],
  },
  {
    id: 2, companyId: COMPANY_ID, eventType: "Customer Credit Note", description: "Customer credit note", isActive: true, createdAt: "2025-01-14T09:00:00Z",
    lines: [
      { id: 4, postingRuleId: 2, lineOrder: 0, side: "Debit", role: "sales_returns", fixedAccountCode: "4100", amountSource: "net" },
      { id: 5, postingRuleId: 2, lineOrder: 1, side: "Debit", role: "vat_output", fixedAccountCode: "2200", amountSource: "vat" },
      { id: 6, postingRuleId: 2, lineOrder: 2, side: "Credit", role: "debtors", fixedAccountCode: "1100", amountSource: "gross" },
    ],
  },
  {
    id: 3, companyId: COMPANY_ID, eventType: "Customer Receipt", description: "Receipt from a customer", isActive: true, createdAt: "2025-01-14T09:00:00Z",
    lines: [
      { id: 7, postingRuleId: 3, lineOrder: 0, side: "Debit", role: "bank", fixedAccountCode: "1000", amountSource: "gross" },
      { id: 8, postingRuleId: 3, lineOrder: 1, side: "Credit", role: "debtors", fixedAccountCode: "1100", amountSource: "gross" },
    ],
  },
  {
    id: 4, companyId: COMPANY_ID, eventType: "Supplier Invoice", description: "Supplier bill", isActive: true, createdAt: "2025-01-14T09:00:00Z",
    lines: [
      { id: 9, postingRuleId: 4, lineOrder: 0, side: "Debit", role: "dynamic_expense", fixedAccountCode: null, amountSource: "net" },
      { id: 10, postingRuleId: 4, lineOrder: 1, side: "Debit", role: "vat_input", fixedAccountCode: "2100", amountSource: "vat" },
      { id: 11, postingRuleId: 4, lineOrder: 2, side: "Credit", role: "creditors", fixedAccountCode: "2000", amountSource: "gross" },
    ],
  },
  {
    id: 5, companyId: COMPANY_ID, eventType: "Supplier Credit Note", description: "Supplier credit note", isActive: true, createdAt: "2025-01-14T09:00:00Z",
    lines: [
      { id: 12, postingRuleId: 5, lineOrder: 0, side: "Debit", role: "creditors", fixedAccountCode: "2000", amountSource: "gross" },
      { id: 13, postingRuleId: 5, lineOrder: 1, side: "Credit", role: "dynamic_expense", fixedAccountCode: null, amountSource: "net" },
      { id: 14, postingRuleId: 5, lineOrder: 2, side: "Credit", role: "vat_input", fixedAccountCode: "2100", amountSource: "vat" },
    ],
  },
  {
    id: 6, companyId: COMPANY_ID, eventType: "Supplier Payment", description: "Payment to a supplier", isActive: true, createdAt: "2025-01-14T09:00:00Z",
    lines: [
      { id: 15, postingRuleId: 6, lineOrder: 0, side: "Debit", role: "creditors", fixedAccountCode: "2000", amountSource: "gross" },
      { id: 16, postingRuleId: 6, lineOrder: 1, side: "Credit", role: "bank", fixedAccountCode: "1000", amountSource: "gross" },
    ],
  },
  {
    id: 7, companyId: COMPANY_ID, eventType: "Bank Charges", description: "Bank charges / fees", isActive: true, createdAt: "2025-01-14T09:00:00Z",
    lines: [
      { id: 17, postingRuleId: 7, lineOrder: 0, side: "Debit", role: "bank_charges", fixedAccountCode: "6100", amountSource: "gross" },
      { id: 18, postingRuleId: 7, lineOrder: 1, side: "Credit", role: "bank", fixedAccountCode: "1000", amountSource: "gross" },
    ],
  },
  {
    id: 8, companyId: COMPANY_ID, eventType: "Interest Received", description: "Interest received", isActive: true, createdAt: "2025-01-14T09:00:00Z",
    lines: [
      { id: 19, postingRuleId: 8, lineOrder: 0, side: "Debit", role: "bank", fixedAccountCode: "1000", amountSource: "gross" },
      { id: 20, postingRuleId: 8, lineOrder: 1, side: "Credit", role: "interest_received", fixedAccountCode: "6200", amountSource: "gross" },
    ],
  },
];

// ---------------------------------------------------------------------
// Journals — one of each real workflow state, including a Posted+
// Reversed pair, so every status/action the Journals tab needs to render
// has a real example to show. "Today" for age-based signals is fixed at
// 2026-07-30 (this file's own reference point, not the wall clock).
// ---------------------------------------------------------------------

const TODAY = "2026-07-30";

function journalLine(id: number, journalId: number, overrides: Partial<JournalLine>): JournalLine {
  return { id, journalId, accountCode: "", debit: 0, credit: 0, description: "", lineOrder: 0, ...overrides };
}

function journal(overrides: Partial<Journal> & Pick<Journal, "id" | "journalNumber" | "journalDate" | "journalType" | "description" | "status" | "lines">): Journal {
  const totalDebit = Math.round(overrides.lines.reduce((sum, l) => sum + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(overrides.lines.reduce((sum, l) => sum + l.credit, 0) * 100) / 100;
  return {
    companyId: COMPANY_ID,
    reference: "",
    sourceType: "manual",
    sourceId: null,
    totalDebit,
    totalCredit,
    createdAt: `${overrides.journalDate}T09:00:00Z`,
    postedAt: null,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    isReversed: false,
    reversalOfJournalId: null,
    reversedByJournalId: null,
    postingBatchId: null,
    ...overrides,
  };
}

export const MOCK_JOURNALS: Journal[] = [
  journal({
    id: 1, journalNumber: "JR000001", journalDate: "2026-07-28", journalType: "Bank Charges",
    description: "Monthly bank fees", status: "Draft", sourceType: "manual",
    lines: [
      journalLine(1, 1, { accountCode: "6100", debit: 85, description: "Monthly bank fees" }),
      journalLine(2, 1, { accountCode: "1000", credit: 85, description: "Monthly bank fees" }),
    ],
  }),
  journal({
    id: 2, journalNumber: "JR000002", journalDate: "2026-07-25", journalType: "Supplier Payment",
    description: "Payment to Renwick Office Supplies", status: "Submitted", sourceType: "manual",
    submittedBy: "finance@fenwickrowe.co.za", submittedAt: "2026-07-25T14:00:00Z",
    lines: [
      journalLine(3, 2, { accountCode: "2000", debit: 4200, description: "Payment to Renwick Office Supplies" }),
      journalLine(4, 2, { accountCode: "1000", credit: 4200, description: "Payment to Renwick Office Supplies" }),
    ],
  }),
  journal({
    id: 3, journalNumber: "JR000003", journalDate: "2026-07-18", journalType: "Sales Invoice",
    description: "Invoice INV-3341 — Meridian Traders", status: "Approved", sourceType: "manual",
    submittedBy: "finance@fenwickrowe.co.za", submittedAt: "2026-07-18T10:00:00Z",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-07-18T15:00:00Z",
    lines: [
      journalLine(5, 3, { accountCode: "1100", debit: 11500, description: "Invoice INV-3341" }),
      journalLine(6, 3, { accountCode: "4000", credit: 10000, description: "Invoice INV-3341" }),
      journalLine(7, 3, { accountCode: "2200", credit: 1500, description: "Invoice INV-3341" }),
    ],
  }),
  journal({
    id: 4, journalNumber: "JR000004", journalDate: "2026-07-15", journalType: "Customer Receipt",
    description: "Receipt — duplicate of already-recorded payment", status: "Rejected", sourceType: "manual",
    submittedBy: "finance@fenwickrowe.co.za", submittedAt: "2026-07-15T09:00:00Z",
    rejectedBy: "controller@fenwickrowe.co.za", rejectedAt: "2026-07-15T16:00:00Z",
    lines: [
      journalLine(8, 4, { accountCode: "1000", debit: 2000, description: "Receipt" }),
      journalLine(9, 4, { accountCode: "1100", credit: 2000, description: "Receipt" }),
    ],
  }),
  journal({
    id: 5, journalNumber: "JR000005", journalDate: "2026-07-10", journalType: "Supplier Invoice",
    description: "Bill entered in error, superseded by JR000012", status: "Cancelled", sourceType: "manual",
    cancelledBy: "finance@fenwickrowe.co.za", cancelledAt: "2026-07-11T08:30:00Z",
    lines: [
      journalLine(10, 5, { accountCode: "5000", debit: 1000, description: "Bill entered in error" }),
      journalLine(11, 5, { accountCode: "2000", credit: 1000, description: "Bill entered in error" }),
    ],
  }),
  journal({
    id: 6, journalNumber: "JR000006", journalDate: "2026-06-05", journalType: "Bank Charges",
    description: "Monthly bank fees", status: "Posted", sourceType: "manual",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-06-05T11:00:00Z",
    postedAt: "2026-06-06T06:00:00Z", postingBatchId: 1,
    lines: [
      journalLine(12, 6, { accountCode: "6100", debit: 250, description: "Monthly bank fees" }),
      journalLine(13, 6, { accountCode: "1000", credit: 250, description: "Monthly bank fees" }),
    ],
  }),
  journal({
    id: 7, journalNumber: "JR000007", journalDate: "2026-06-05", journalType: "Bank Charges",
    description: "Monthly bank fees (re-entered)", status: "Posted", sourceType: "manual",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-06-05T11:05:00Z",
    postedAt: "2026-06-06T06:00:00Z", postingBatchId: 1,
    lines: [
      journalLine(14, 7, { accountCode: "6100", debit: 250, description: "Monthly bank fees (re-entered)" }),
      journalLine(15, 7, { accountCode: "1000", credit: 250, description: "Monthly bank fees (re-entered)" }),
    ],
  }),
  journal({
    id: 8, journalNumber: "JR000008", journalDate: "2026-06-20", journalType: "Interest Received",
    description: "Interest on call account", status: "Posted", sourceType: "manual",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-06-20T09:00:00Z",
    postedAt: "2026-06-21T06:00:00Z", postingBatchId: 2,
    lines: [
      journalLine(16, 8, { accountCode: "1000", debit: 500, description: "Interest on call account" }),
      journalLine(17, 8, { accountCode: "6200", credit: 500, description: "Interest on call account" }),
    ],
  }),
  journal({
    id: 9, journalNumber: "JR000009", journalDate: "2026-05-10", journalType: "Bank Charges",
    description: "Bank fees — reversed, wrong account used", status: "Posted", sourceType: "manual",
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-05-10T09:00:00Z",
    postedAt: "2026-05-11T06:00:00Z", postingBatchId: 3,
    isReversed: true, reversedByJournalId: 10,
    lines: [
      journalLine(18, 9, { accountCode: "6100", debit: 400, description: "Bank fees — wrong account" }),
      journalLine(19, 9, { accountCode: "1000", credit: 400, description: "Bank fees — wrong account" }),
    ],
  }),
  journal({
    id: 10, journalNumber: "JR000010", journalDate: "2026-07-29", journalType: "Reversal",
    description: "Reversal of JR000009", status: "Approved", sourceType: "journal_reversal", sourceId: 9,
    approvedBy: "controller@fenwickrowe.co.za", approvedAt: "2026-07-29T09:00:00Z",
    reversalOfJournalId: 9,
    lines: [
      journalLine(20, 10, { accountCode: "6100", credit: 400, description: "Bank fees — wrong account" }),
      journalLine(21, 10, { accountCode: "1000", debit: 400, description: "Bank fees — wrong account" }),
    ],
  }),
];

// ---------------------------------------------------------------------
// GL Transactions — the postings from the 4 Posted journals above
// (JR000006/7/8/9). JR000006/JR000007 are deliberately identical
// (account/date/side/amount, different journals) to give the Financial
// Intelligence "possible duplicate" signal a real example to surface.
// ---------------------------------------------------------------------

function glTxn(overrides: Pick<GlTransactionWithContext, "id" | "journalId" | "journalLineId" | "accountId" | "accountCode" | "accountDescription" | "postingDate" | "debit" | "credit" | "description" | "journalNumber">): GlTransactionWithContext {
  const financialYearLabel = computeFinancialYearLabel(overrides.postingDate, START_MONTH);
  const financialPeriod = computeFinancialPeriod(overrides.postingDate, START_MONTH);
  return {
    companyId: COMPANY_ID,
    reference: "",
    financialYearLabel,
    financialPeriod,
    postedAt: `${overrides.postingDate}T06:00:00Z`,
    postedBy: "controller@fenwickrowe.co.za",
    sourceType: "manual",
    ...overrides,
  };
}

export const MOCK_GL_TRANSACTIONS: GlTransactionWithContext[] = [
  glTxn({ id: 1, journalId: 6, journalLineId: 12, accountId: 10, accountCode: "6100", accountDescription: "Bank Charges", postingDate: "2026-06-05", debit: 250, credit: 0, description: "Monthly bank fees", journalNumber: "JR000006" }),
  glTxn({ id: 2, journalId: 6, journalLineId: 13, accountId: 1, accountCode: "1000", accountDescription: "Bank", postingDate: "2026-06-05", debit: 0, credit: 250, description: "Monthly bank fees", journalNumber: "JR000006" }),
  glTxn({ id: 3, journalId: 7, journalLineId: 14, accountId: 10, accountCode: "6100", accountDescription: "Bank Charges", postingDate: "2026-06-05", debit: 250, credit: 0, description: "Monthly bank fees (re-entered)", journalNumber: "JR000007" }),
  glTxn({ id: 4, journalId: 7, journalLineId: 15, accountId: 1, accountCode: "1000", accountDescription: "Bank", postingDate: "2026-06-05", debit: 0, credit: 250, description: "Monthly bank fees (re-entered)", journalNumber: "JR000007" }),
  glTxn({ id: 5, journalId: 8, journalLineId: 16, accountId: 1, accountCode: "1000", accountDescription: "Bank", postingDate: "2026-06-20", debit: 500, credit: 0, description: "Interest on call account", journalNumber: "JR000008" }),
  glTxn({ id: 6, journalId: 8, journalLineId: 17, accountId: 11, accountCode: "6200", accountDescription: "Interest Received", postingDate: "2026-06-20", debit: 0, credit: 500, description: "Interest on call account", journalNumber: "JR000008" }),
  glTxn({ id: 7, journalId: 9, journalLineId: 18, accountId: 10, accountCode: "6100", accountDescription: "Bank Charges", postingDate: "2026-05-10", debit: 400, credit: 0, description: "Bank fees — wrong account", journalNumber: "JR000009" }),
  glTxn({ id: 8, journalId: 9, journalLineId: 19, accountId: 1, accountCode: "1000", accountDescription: "Bank", postingDate: "2026-05-10", debit: 0, credit: 400, description: "Bank fees — wrong account", journalNumber: "JR000009" }),
];

// A smaller "prior period" posting set — exists only to give
// `findUnusualGrowth` something real to compare the above against; not
// otherwise part of the Preview Mode ledger.
const MOCK_PREVIOUS_PERIOD_GL_TRANSACTIONS: GlTransactionWithContext[] = [
  glTxn({ id: 101, journalId: 50, journalLineId: 101, accountId: 10, accountCode: "6100", accountDescription: "Bank Charges", postingDate: "2026-05-05", debit: 90, credit: 0, description: "Monthly bank fees", journalNumber: "JR000050" }),
  glTxn({ id: 102, journalId: 50, journalLineId: 102, accountId: 1, accountCode: "1000", accountDescription: "Bank", postingDate: "2026-05-05", debit: 0, credit: 90, description: "Monthly bank fees", journalNumber: "JR000050" }),
];

// ---------------------------------------------------------------------
// Trial Balance — every active account, aggregated from the real GL
// postings above via the real mapper/summary functions (not hand-typed
// totals), so the debit/credit columns are guaranteed to actually balance.
// ---------------------------------------------------------------------

function buildMockTrialBalance(): TrialBalance {
  const totalsByAccountId = new Map<number, { debit: number; credit: number }>();
  for (const t of MOCK_GL_TRANSACTIONS) {
    const existing = totalsByAccountId.get(t.accountId) ?? { debit: 0, credit: 0 };
    existing.debit += t.debit;
    existing.credit += t.credit;
    totalsByAccountId.set(t.accountId, existing);
  }

  const rpcRows: TrialBalanceRpcRow[] = MOCK_CHART_OF_ACCOUNTS.map((account) => {
    const totals = totalsByAccountId.get(account.id) ?? { debit: 0, credit: 0 };
    return {
      account_id: account.id,
      account_code: account.accountCode,
      description: account.description,
      account_type: account.accountType,
      normal_balance: account.normalBalance,
      total_debit: totals.debit,
      total_credit: totals.credit,
    };
  });

  const rows = rpcRows.map(trialBalanceRowFromRpcRow);
  const { totalDebit, totalCredit } = summarizeTrialBalance(rows);
  return { asOfDate: null, rows, totalDebit, totalCredit };
}

export const MOCK_TRIAL_BALANCE: TrialBalance = buildMockTrialBalance();

// ---------------------------------------------------------------------
// Account Activity — works for ANY account/date range, not just one
// curated example, so drilling into any account from Trial Balance/GL
// Inquiry in Preview Mode produces real (if sparse) derived data rather
// than a page that only works for one hardcoded id.
//
// Only Balance Sheet accounts (Asset/Liability/Equity) carry an opening
// balance forward from before `dateFrom` — Income/Cost of Sales/Expense/
// Other Income/Other Expense accounts are correctly zeroed at the start
// of a financial year (they close to Retained Income), so giving them a
// carried-forward balance would be accounting-wrong, not just a demo
// shortcut. Bank (1000) additionally gets a fixed "assumed real-world
// prior history" base — otherwise every demo account would start from
// literally nothing before this file's own May 2026 mock postings began.
// ---------------------------------------------------------------------

const BALANCE_SHEET_TYPES = new Set(["Asset", "Liability", "Equity"]);
const BANK_ACCOUNT_ID = 1;
const BANK_DEMO_BASE_BALANCE = 42_500;

export function buildPreviewAccountActivity(accountId: number, dateFrom: string, dateTo: string): AccountActivity | null {
  const account = MOCK_CHART_OF_ACCOUNTS.find((a) => a.id === accountId);
  if (!account) return null;

  let openingBalance = 0;
  if (BALANCE_SHEET_TYPES.has(account.accountType)) {
    const before = MOCK_GL_TRANSACTIONS.filter((t) => t.accountId === accountId && t.postingDate < dateFrom);
    const beforeDebit = before.reduce((sum, t) => sum + t.debit, 0);
    const beforeCredit = before.reduce((sum, t) => sum + t.credit, 0);
    openingBalance = account.normalBalance === "Debit" ? beforeDebit - beforeCredit : beforeCredit - beforeDebit;
    if (accountId === BANK_ACCOUNT_ID) openingBalance += BANK_DEMO_BASE_BALANCE;
  }

  const transactions: GlTransaction[] = MOCK_GL_TRANSACTIONS.filter(
    (t) => t.accountId === accountId && t.postingDate >= dateFrom && t.postingDate <= dateTo,
  );
  const totalDebit = Math.round(transactions.reduce((sum, t) => sum + t.debit, 0) * 100) / 100;
  const totalCredit = Math.round(transactions.reduce((sum, t) => sum + t.credit, 0) * 100) / 100;
  const periodMovement = account.normalBalance === "Debit" ? totalDebit - totalCredit : totalCredit - totalDebit;
  const closingBalance = Math.round((openingBalance + periodMovement) * 100) / 100;

  return { account, dateFrom, dateTo, openingBalance, closingBalance, totalDebit, totalCredit, transactions, monthlyTrend: buildMonthlyTrend(transactions) };
}

/** Same-length period one year earlier — a flat, plausible prior-year
 * movement per account type, since the mock ledger itself only spans a
 * few months and has no real year-ago data to compare against. */
export function buildPreviewYearComparison(accountId: number, dateFrom: string, dateTo: string): AccountYearComparison | null {
  const current = buildPreviewAccountActivity(accountId, dateFrom, dateTo);
  if (!current) return null;
  const currentTotal = Math.round((current.closingBalance - current.openingBalance) * 100) / 100;
  const previousTotal = accountId === BANK_ACCOUNT_ID ? -300 : 0;
  const { variance, variancePercent } = computeVariance(currentTotal, previousTotal);
  return { currentTotal, previousTotal, variance, variancePercent };
}

// ---------------------------------------------------------------------
// Financial Intelligence — every signal computed from the same mock
// postings/journals above via the real detection functions, not
// fabricated separately.
// ---------------------------------------------------------------------

function buildMockFinancialIntelligence(): FinancialIntelligenceReport {
  const approvedJournals = MOCK_JOURNALS.filter((j) => j.status === "Approved");
  const draftJournals = MOCK_JOURNALS.filter((j) => j.status === "Draft");

  return {
    generatedAt: `${TODAY}T08:00:00Z`,
    dateFrom: "2026-05-01",
    dateTo: TODAY,
    largestMovements: findLargestMovements(MOCK_GL_TRANSACTIONS, 5),
    possibleDuplicateJournals: findPossibleDuplicateJournals(MOCK_GL_TRANSACTIONS),
    missingPostings: findMissingPostings(approvedJournals, draftJournals, TODAY, 7, 14),
    unusualGrowth: findUnusualGrowth(
      aggregateMovementsByAccount(MOCK_GL_TRANSACTIONS),
      aggregateMovementsByAccount(MOCK_PREVIOUS_PERIOD_GL_TRANSACTIONS),
      50,
    ),
    truncated: false,
  };
}

export const MOCK_FINANCIAL_INTELLIGENCE_REPORT: FinancialIntelligenceReport = buildMockFinancialIntelligence();
