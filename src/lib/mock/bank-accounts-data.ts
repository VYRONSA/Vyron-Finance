/**
 * Preview Mode seed data for Bank Accounts. Field shapes match
 * `BankAccountSummary` exactly — the same type the real API returns —
 * so the UI never branches on "is this mock or real" beyond the top-level
 * Preview Mode check already established in Module 1.
 */

import type { BankAccountSummary } from "@/server/accounting/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_BANK_ACCOUNT_SUMMARIES: BankAccountSummary[] = [
  {
    account: {
      id: 1,
      companyId: COMPANY_ID,
      accountNumber: "62050837304",
      accountName: "Main Trading Account",
      bankName: "First National Bank",
      accountType: "Business Cheque",
      branch: "250655",
      currency: "ZAR",
      status: "Active",
      openingBalance: 250000,
      currentBalance: 412650.75,
      lastReconciliationDate: "2026-07-25",
      notes: "",
      createdAt: "2026-01-14T09:00:00Z",
      glAccount: "1000 — Bank Current Account",
    },
    statementCount: 7,
    transactionCount: 341,
    totalDebits: 892340.5,
    totalCredits: 1054991.25,
    lastImport: "2026-07-29",
    matched: 298,
    suggested: 31,
    unallocated: 12,
  },
  {
    account: {
      id: 2,
      companyId: COMPANY_ID,
      accountNumber: "1961234567",
      accountName: "Payroll Account",
      bankName: "Nedbank",
      accountType: "Current Account",
      branch: "198765",
      currency: "ZAR",
      status: "Active",
      openingBalance: 80000,
      currentBalance: 96420.1,
      lastReconciliationDate: "2026-07-20",
      notes: "",
      createdAt: "2026-02-03T09:00:00Z",
      glAccount: "1010 — Payroll Bank Account",
    },
    statementCount: 6,
    transactionCount: 84,
    totalDebits: 410200,
    totalCredits: 426620.1,
    lastImport: "2026-07-22",
    matched: 79,
    suggested: 3,
    unallocated: 2,
  },
  {
    account: {
      id: 3,
      companyId: COMPANY_ID,
      accountNumber: "334455667",
      accountName: "Reserve Account",
      bankName: "Standard Bank",
      accountType: "Business Savings",
      branch: "051001",
      currency: "ZAR",
      status: "Archived",
      openingBalance: 150000,
      currentBalance: 150000,
      lastReconciliationDate: null,
      notes: "Closed after Standard Bank facility was consolidated into FNB in June 2026.",
      createdAt: "2025-11-02T09:00:00Z",
      glAccount: "",
    },
    statementCount: 2,
    transactionCount: 6,
    totalDebits: 0,
    totalCredits: 150000,
    lastImport: "2026-01-08",
    matched: 6,
    suggested: 0,
    unallocated: 0,
  },
];

export type MockRecentTransaction = {
  id: number;
  transactionDate: string | null;
  description: string;
  beneficiary: string;
  debit: number;
  credit: number;
  allocationStatus: string;
};

export const MOCK_RECENT_TRANSACTIONS_BY_ACCOUNT: Record<number, MockRecentTransaction[]> = {
  1: [
    { id: 501, transactionDate: "2026-07-29", description: "Payment INV-3381", beneficiary: "Fenwick Office Supplies", debit: 612.5, credit: 0, allocationStatus: "Matched" },
    { id: 500, transactionDate: "2026-07-29", description: "June freight", beneficiary: "Netherfield Freight Ltd", debit: 1470, credit: 0, allocationStatus: "Matched" },
    { id: 499, transactionDate: "2026-07-28", description: "Till 4 settlement", beneficiary: "Card Settlement", debit: 0, credit: 3240.75, allocationStatus: "Matched" },
    { id: 498, transactionDate: "2026-07-28", description: "Part payment HP-118", beneficiary: "Harrow Print & Design", debit: 150, credit: 0, allocationStatus: "Suggested" },
    { id: 497, transactionDate: "2026-07-27", description: "Unknown EFT", beneficiary: "REF 88213 EFT", debit: 240, credit: 0, allocationStatus: "Unallocated" },
  ],
  2: [
    { id: 601, transactionDate: "2026-07-22", description: "July payroll run", beneficiary: "Staff Payroll", debit: 84200, credit: 0, allocationStatus: "Matched" },
    { id: 600, transactionDate: "2026-07-15", description: "Transfer from Main Trading Account", beneficiary: "Internal Transfer", debit: 0, credit: 90000, allocationStatus: "Matched" },
  ],
  3: [
    { id: 701, transactionDate: "2026-01-08", description: "Facility consolidation", beneficiary: "Standard Bank", debit: 0, credit: 150000, allocationStatus: "Matched" },
  ],
};
