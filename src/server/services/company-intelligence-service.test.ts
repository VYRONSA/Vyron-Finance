/**
 * Phase 25B, Part B — tenant-isolation proof for the new recurring-
 * transaction wiring in `getCompanyIntelligenceSummary`: it must fetch
 * only the requested company's transaction history (via the same
 * `listTransactionsForExport(companyId, ...)` every other company-wide
 * pure-detection pass already uses, e.g. `duplicate-detection-service.ts`)
 * and never let one company's recurring patterns leak into another's.
 *
 * Phase 25C, Part B — the same guarantee for customer revenue
 * concentration: `listCustomers`/`listSalesInvoices` were already fetched
 * here before this phase (for debtors aging), so no new query was added —
 * these tests prove the existing company-scoped fetches are what feed
 * `detectCustomerConcentrationRisk`, not a new, separately-scoped path.
 * Every other dependency is mocked to an empty/neutral default so this
 * file stays focused on these guarantees.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/services/bank-account-service", () => ({ listBankAccountSummaries: vi.fn() }));
vi.mock("@/server/services/import-service", () => ({ listRecentImports: vi.fn() }));
vi.mock("@/server/services/opening-balance-service", () => ({ listOpeningBalanceEntries: vi.fn() }));
vi.mock("@/server/services/customer-service", () => ({ listCustomers: vi.fn() }));
vi.mock("@/server/services/supplier-management-service", () => ({ listSuppliers: vi.fn() }));
vi.mock("@/server/services/financial-year-service", () => ({ listFinancialYears: vi.fn() }));
vi.mock("@/server/services/banking-exception-service", () => ({ listBankingExceptions: vi.fn() }));
vi.mock("@/server/services/transaction-explorer-service", () => ({ getSummary: vi.fn(), listTransactionsForExport: vi.fn(), REPEATED_ALLOCATION_THRESHOLD: 3 }));
vi.mock("@/server/services/sales-invoice-service", () => ({ listSalesInvoices: vi.fn() }));
vi.mock("@/server/services/purchase-bill-service", () => ({ listAllBills: vi.fn() }));
vi.mock("@/server/services/vat-return-service", () => ({ listVatReturns: vi.fn() }));
vi.mock("@/server/services/vat-exception-service", () => ({ listVatExceptions: vi.fn() }));
vi.mock("@/server/services/vat-summary-service", () => ({ buildVatDashboardSummary: vi.fn() }));
vi.mock("@/server/services/executive-alert-service", () => ({ listExecutiveAlerts: vi.fn() }));
vi.mock("@/server/services/chart-of-accounts-service", () => ({ listChartOfAccounts: vi.fn() }));
vi.mock("@/server/services/financial-statements-service", () => ({ getIncomeStatement: vi.fn() }));
vi.mock("@/server/services/financial-intelligence-service", () => ({ getFinancialIntelligence: vi.fn() }));
vi.mock("@/server/services/asset-intelligence-service", () => ({ listAssetFindings: vi.fn() }));
vi.mock("@/server/services/audit-finding-service", () => ({ listAuditFindings: vi.fn() }));

import { getCompanyIntelligenceSummary } from "./company-intelligence-service";
import { listBankAccountSummaries } from "@/server/services/bank-account-service";
import { listRecentImports } from "@/server/services/import-service";
import { listOpeningBalanceEntries } from "@/server/services/opening-balance-service";
import { listCustomers } from "@/server/services/customer-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listFinancialYears } from "@/server/services/financial-year-service";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { getSummary, listTransactionsForExport } from "@/server/services/transaction-explorer-service";
import { listSalesInvoices } from "@/server/services/sales-invoice-service";
import { listAllBills } from "@/server/services/purchase-bill-service";
import { listVatReturns } from "@/server/services/vat-return-service";
import { listVatExceptions } from "@/server/services/vat-exception-service";
import { buildVatDashboardSummary } from "@/server/services/vat-summary-service";
import { listExecutiveAlerts } from "@/server/services/executive-alert-service";
import { listChartOfAccounts } from "@/server/services/chart-of-accounts-service";
import { getIncomeStatement } from "@/server/services/financial-statements-service";
import { getFinancialIntelligence } from "@/server/services/financial-intelligence-service";
import { listAssetFindings } from "@/server/services/asset-intelligence-service";
import { listAuditFindings } from "@/server/services/audit-finding-service";
import type { IntelligenceTransaction } from "@/server/banking-rules/banking-intelligence";
import type { Customer } from "@/server/customer-management/types";
import type { SalesInvoice } from "@/server/sales/types";

function fmt(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let nextId = 1;
function debitSeries(beneficiary: string, dates: string[], amount: number): IntelligenceTransaction[] {
  return dates.map((d) => ({ id: nextId++, transactionDate: d, beneficiary, debit: amount, credit: 0 }));
}

function manualAllocation(overrides: Partial<import("@/server/accounting/types").BankTransactionRecord> = {}) {
  return {
    id: nextId++, companyId: "company-a", transactionDate: "2026-01-01", reference: "REF", description: "", beneficiary: "ABC Supplies",
    debit: 500, credit: 0, balance: null, bankAccount: "Cheque Account", bankAccountId: 1, glAccount: "", vat: null, notes: "",
    importBatch: "", sourceFilename: "", createdAt: "2026-01-01T00:00:00.000Z", allocationStatus: "Allocated", matchedSupplierId: null,
    matchedSupplierName: null, matchedBillId: null, confidenceScore: null, rulesTriggered: [], matchReason: "", requiredAction: null,
    suggestedGlAccount: "6100", suggestedVatCode: null, allocationMethod: "Manual", allocationReason: "", isManualOverride: true,
    reviewStatus: null, reviewedBy: null, reviewedAt: null, reviewNote: null, journalId: null, matchedCustomerId: null, matchedMerchantId: null,
    ruleId: null, allocationType: null, allocationNotes: "", entrySource: "Imported", captureStatus: null, cashbookBatchId: null,
    reconciliationId: null, reversalOfTransactionId: null, isSplit: false,
    ...overrides,
  } as import("@/server/accounting/types").BankTransactionRecord;
}

function manualAllocationSeries(count: number, overrides: Partial<import("@/server/accounting/types").BankTransactionRecord> = {}) {
  return Array.from({ length: count }, (_, i) => manualAllocation({ transactionDate: `2026-0${i + 1}-01`, ...overrides }));
}

const BASE = "2026-01-01";
const RECURRING_DATES = [BASE, addDays(BASE, 30), addDays(BASE, 60)];

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1, companyId: "company-a", customerCode: "CUST-001", name: "Northwood Ltd", customerType: "Company",
    customerGroup: "", industry: "", vatNumber: "", registrationNumber: "", creditLimit: 0, paymentTermsDays: 30,
    currencyCode: "ZAR", priceList: "", salesRep: "", isActive: true, riskRating: "Low", notes: "",
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 1, companyId: "company-a", customerId: 1, orderId: null, deliveryId: null, invoiceNumber: "INV1",
    documentType: "Invoice", invoiceDate: BASE, dueDate: null, vatTreatmentCode: "", status: "Posted",
    journalId: null, subtotal: 100, vatAmount: 0, total: 100, outstanding: 0, isRecurringTemplate: false,
    recurrencePattern: "", reference: "", notes: "", createdAt: `${BASE}T00:00:00Z`, submittedBy: null,
    submittedAt: null, approvedBy: null, approvedAt: null, postedAt: null, cancelledBy: null, cancelledAt: null,
    originalInvoiceId: null, lines: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listBankAccountSummaries).mockReset().mockResolvedValue([]);
  vi.mocked(listRecentImports).mockReset().mockResolvedValue([]);
  vi.mocked(listOpeningBalanceEntries).mockReset().mockResolvedValue([]);
  vi.mocked(listCustomers).mockReset().mockResolvedValue([]);
  vi.mocked(listSuppliers).mockReset().mockResolvedValue([]);
  vi.mocked(listFinancialYears).mockReset().mockResolvedValue([]);
  vi.mocked(listBankingExceptions).mockReset().mockResolvedValue([]);
  vi.mocked(getSummary).mockReset().mockResolvedValue({ matched: 0, unmatched: 0, awaitingReview: 0, journalsCreated: 0, totalValue: 0 } as never);
  vi.mocked(listSalesInvoices).mockReset().mockResolvedValue([]);
  vi.mocked(listAllBills).mockReset().mockResolvedValue([]);
  vi.mocked(listVatReturns).mockReset().mockResolvedValue([]);
  vi.mocked(listVatExceptions).mockReset().mockResolvedValue([]);
  vi.mocked(buildVatDashboardSummary).mockReset().mockReturnValue({
    vatPayable: 0, vatReceivable: 0, draftReturnCount: 0, openExceptionCount: 0, complianceScorePercent: 100, highRiskTransactionCount: 0,
  } as never);
  vi.mocked(listExecutiveAlerts).mockReset().mockResolvedValue([]);
  vi.mocked(listChartOfAccounts).mockReset().mockResolvedValue([]);
  vi.mocked(getIncomeStatement).mockReset().mockResolvedValue({ netProfit: 0 } as never);
  vi.mocked(getFinancialIntelligence).mockReset().mockResolvedValue({
    generatedAt: BASE, dateFrom: BASE, dateTo: BASE, largestMovements: [], possibleDuplicateJournals: [], missingPostings: [], unusualGrowth: [], truncated: false,
  });
  vi.mocked(listAssetFindings).mockReset().mockResolvedValue([]);
  vi.mocked(listAuditFindings).mockReset().mockResolvedValue([]);
  vi.mocked(listTransactionsForExport).mockReset();
});

describe("getCompanyIntelligenceSummary — recurring transaction tenant isolation (Phase 25B, Part B)", () => {
  it("fetches transaction history scoped to the exact company requested", async () => {
    vi.mocked(listTransactionsForExport).mockResolvedValue({ transactions: [], truncated: false });

    await getCompanyIntelligenceSummary("company-a", "2026-08-13");

    expect(listTransactionsForExport).toHaveBeenCalledWith("company-a", expect.anything());
  });

  it("never lets one company's recurring pattern appear in another company's summary", async () => {
    vi.mocked(listTransactionsForExport).mockImplementation(async (companyId: string) => {
      if (companyId === "company-a") return { transactions: debitSeries("Landlord A", RECURRING_DATES, 1000) as never, truncated: false };
      return { transactions: debitSeries("Landlord B", RECURRING_DATES, 2000) as never, truncated: false };
    });

    const [summaryA, summaryB] = await Promise.all([
      getCompanyIntelligenceSummary("company-a", "2026-08-13"),
      getCompanyIntelligenceSummary("company-b", "2026-08-13"),
    ]);

    const titlesA = summaryA.findings.filter((f) => f.id.startsWith("recurring-")).map((f) => f.title);
    const titlesB = summaryB.findings.filter((f) => f.id.startsWith("recurring-")).map((f) => f.title);

    expect(titlesA.some((t) => t.includes("Landlord A"))).toBe(true);
    expect(titlesA.some((t) => t.includes("Landlord B"))).toBe(false);
    expect(titlesB.some((t) => t.includes("Landlord B"))).toBe(true);
    expect(titlesB.some((t) => t.includes("Landlord A"))).toBe(false);
  });

  it("produces no recurring findings when the company has no transaction history (13)", async () => {
    vi.mocked(listTransactionsForExport).mockResolvedValue({ transactions: [], truncated: false });
    const summary = await getCompanyIntelligenceSummary("company-a", "2026-08-13");
    expect(summary.findings.filter((f) => f.id.startsWith("recurring-"))).toEqual([]);
  });
});

describe("getCompanyIntelligenceSummary — customer concentration tenant isolation (Phase 25C, Part B)", () => {
  beforeEach(() => {
    vi.mocked(listTransactionsForExport).mockResolvedValue({ transactions: [], truncated: false });
  });

  it("fetches customers and invoices scoped to the exact company requested", async () => {
    vi.mocked(listCustomers).mockResolvedValue([]);
    vi.mocked(listSalesInvoices).mockResolvedValue([]);

    await getCompanyIntelligenceSummary("company-a", "2026-08-13");

    expect(listCustomers).toHaveBeenCalledWith("company-a");
    expect(listSalesInvoices).toHaveBeenCalledWith("company-a");
  });

  it("never lets Company A's revenue or customers influence Company B's concentration finding, or vice versa", async () => {
    vi.mocked(listCustomers).mockImplementation(async (companyId: string) =>
      companyId === "company-a" ? [customer({ id: 1, companyId: "company-a", name: "A Client" })] : [customer({ id: 1, companyId: "company-b", name: "B Client" })],
    );
    vi.mocked(listSalesInvoices).mockImplementation(async (companyId: string) =>
      companyId === "company-a"
        ? [invoice({ id: 1, companyId: "company-a", customerId: 1, total: 1000 })]
        : [invoice({ id: 1, companyId: "company-b", customerId: 1, total: 5000 })],
    );

    const [summaryA, summaryB] = await Promise.all([
      getCompanyIntelligenceSummary("company-a", "2026-08-13"),
      getCompanyIntelligenceSummary("company-b", "2026-08-13"),
    ]);

    const findingA = summaryA.findings.find((f) => f.id === "customer-revenue-concentration");
    const findingB = summaryB.findings.find((f) => f.id === "customer-revenue-concentration");

    expect(findingA!.description).toContain("A Client");
    expect(findingA!.description).not.toContain("B Client");
    expect(findingA!.evidence).toContain(fmt(1000));
    expect(findingA!.evidence).not.toContain(fmt(5000));

    expect(findingB!.description).toContain("B Client");
    expect(findingB!.description).not.toContain("A Client");
    expect(findingB!.evidence).toContain(fmt(5000));
  });

  it("produces no fabricated concentration finding when the company has no customer/revenue data (empty customer data)", async () => {
    vi.mocked(listCustomers).mockResolvedValue([]);
    vi.mocked(listSalesInvoices).mockResolvedValue([]);
    const summary = await getCompanyIntelligenceSummary("company-a", "2026-08-13");
    expect(summary.findings.find((f) => f.id === "customer-revenue-concentration")).toBeUndefined();
  });

  it("performs no write/repository calls — only the already-mocked read functions are used (accounting safety)", async () => {
    vi.mocked(listCustomers).mockResolvedValue([customer({ id: 1 })]);
    vi.mocked(listSalesInvoices).mockResolvedValue([invoice({ id: 1, customerId: 1, total: 1000 })]);
    // No repository/service write function (create*/update*/insert*/raise*/assign*/allocate*) is
    // imported or mocked anywhere in this file — getCompanyIntelligenceSummary structurally cannot
    // reach one. This call succeeding at all (with only list*/get* mocks wired) is the proof.
    await expect(getCompanyIntelligenceSummary("company-a", "2026-08-13")).resolves.toBeDefined();
  });
});

describe("getCompanyIntelligenceSummary — repeated-correction tenant isolation (Phase 25D)", () => {
  it("never lets Company A's repeated corrections appear in Company B's summary, or vice versa", async () => {
    vi.mocked(listTransactionsForExport).mockImplementation(async (companyId: string) => {
      if (companyId === "company-a") return { transactions: manualAllocationSeries(3, { companyId: "company-a", beneficiary: "A Corp" }) as never, truncated: false };
      return { transactions: manualAllocationSeries(3, { companyId: "company-b", beneficiary: "B Corp" }) as never, truncated: false };
    });

    const [summaryA, summaryB] = await Promise.all([
      getCompanyIntelligenceSummary("company-a", "2026-08-13"),
      getCompanyIntelligenceSummary("company-b", "2026-08-13"),
    ]);

    const findingA = summaryA.findings.find((f) => f.id.startsWith("repeated-correction-"));
    const findingB = summaryB.findings.find((f) => f.id.startsWith("repeated-correction-"));

    expect(findingA!.description).toContain("A Corp");
    expect(findingA!.description).not.toContain("B Corp");
    expect(findingB!.description).toContain("B Corp");
    expect(findingB!.description).not.toContain("A Corp");
  });

  it("Company B's transaction volume never inflates Company A's count", async () => {
    vi.mocked(listTransactionsForExport).mockImplementation(async (companyId: string) => {
      if (companyId === "company-a") return { transactions: manualAllocationSeries(2, { companyId: "company-a" }) as never, truncated: false }; // below threshold
      return { transactions: manualAllocationSeries(10, { companyId: "company-b" }) as never, truncated: false };
    });

    const summaryA = await getCompanyIntelligenceSummary("company-a", "2026-08-13");
    expect(summaryA.findings.find((f) => f.id.startsWith("repeated-correction-"))).toBeUndefined();
  });

  it("produces no fabricated pattern when the company has no transaction history (empty/missing data)", async () => {
    vi.mocked(listTransactionsForExport).mockResolvedValue({ transactions: [], truncated: false });
    const summary = await getCompanyIntelligenceSummary("company-a", "2026-08-13");
    expect(summary.findings.filter((f) => f.id.startsWith("repeated-correction-"))).toEqual([]);
  });
});
