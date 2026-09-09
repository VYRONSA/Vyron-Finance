/**
 * Phase 25B, Part A — `getExecutiveIntelligence`'s Business Risk Score
 * previously always passed hardcoded `overdueDebtorsCount: 0` and
 * `supplierConcentrationRiskCount: 0` to `computeBusinessRiskScore`,
 * silently making the score incomplete no matter the real data. These
 * tests prove both fields now reflect real, existing data
 * (`listSalesInvoices` for overdue debtors, the same supplier-concentration
 * check `detectSupplierRisk` already performs for Executive Alerts) rather
 * than a constant.
 *
 * Phase 25C, Part A — the third hardcoded zero, `highRiskVatTransactionCount`,
 * is now also real: reused verbatim from the exact same "high-risk VAT
 * document" definition `app/company/[companyId]/vat/page.tsx` already
 * displays (`buildVatIntelligence` + `detectMissingVatNumber` + `isHighRisk`
 * over `listVatDocuments`), not a second detector.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/services/financial-intelligence-service", () => ({
  getFinancialIntelligence: vi.fn(),
  shiftPeriodBack: vi.fn((dateFrom: string, dateTo: string) => ({ dateFrom, dateTo })),
}));
vi.mock("@/server/services/banking-exception-service", () => ({ listBankingExceptions: vi.fn() }));
vi.mock("@/server/services/vat-exception-service", () => ({ listVatExceptions: vi.fn() }));
vi.mock("@/server/services/vat-return-service", () => ({ listVatReturns: vi.fn() }));
vi.mock("@/server/services/vat-summary-service", () => ({ computeComplianceScore: vi.fn(() => 100) }));
vi.mock("@/server/services/scheduler-service", () => ({ listAutomationTasks: vi.fn() }));
vi.mock("@/server/services/stock-item-service", () => ({ listStockItems: vi.fn() }));
vi.mock("@/server/services/inventory-transaction-service", () => ({ listInventoryTransactions: vi.fn() }));
vi.mock("@/server/services/inventory-summary-service", () => ({ buildInventoryDashboardSummary: vi.fn() }));
vi.mock("@/server/services/supplier-management-service", () => ({ listSuppliers: vi.fn() }));
vi.mock("@/server/repositories/purchase-bill-repository", () => ({ listPurchaseBills: vi.fn() }));
vi.mock("@/server/services/chart-of-accounts-service", () => ({ listChartOfAccounts: vi.fn() }));
vi.mock("@/server/services/financial-statements-service", () => ({ getIncomeStatement: vi.fn(), getBalanceSheet: vi.fn() }));
vi.mock("@/server/services/forecast-service", () => ({ getCashflowForecast: vi.fn(), getCustomerPaymentForecast: vi.fn() }));
vi.mock("@/server/services/executive-alert-service", () => ({ raiseAlert: vi.fn() }));
vi.mock("@/server/services/sales-invoice-service", () => ({ listSalesInvoices: vi.fn() }));
vi.mock("@/server/services/vat-treatment-service", () => ({ listVatTreatments: vi.fn() }));
vi.mock("@/server/services/vat-transaction-service", () => ({ listVatDocuments: vi.fn() }));
vi.mock("@/server/repositories/vat-rate-history-repository", () => ({ listRateHistoryForCompany: vi.fn() }));

import { getExecutiveIntelligence } from "./executive-intelligence-service";
import { getFinancialIntelligence } from "@/server/services/financial-intelligence-service";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { listVatExceptions } from "@/server/services/vat-exception-service";
import { listVatReturns } from "@/server/services/vat-return-service";
import { listAutomationTasks } from "@/server/services/scheduler-service";
import { listSuppliers } from "@/server/services/supplier-management-service";
import { listPurchaseBills } from "@/server/repositories/purchase-bill-repository";
import { getIncomeStatement, getBalanceSheet } from "@/server/services/financial-statements-service";
import { getCashflowForecast } from "@/server/services/forecast-service";
import { listSalesInvoices } from "@/server/services/sales-invoice-service";
import { listVatTreatments } from "@/server/services/vat-treatment-service";
import { listVatDocuments } from "@/server/services/vat-transaction-service";
import { listRateHistoryForCompany } from "@/server/repositories/vat-rate-history-repository";
import type { SalesInvoice } from "@/server/sales/types";
import type { Supplier } from "@/server/accounting/types";
import type { VatDocument } from "@/server/vat/vat-intelligence";
import type { VatTreatment } from "@/server/company-management/types";
import type { VatRateHistoryEntry } from "@/server/vat/types";

const COMPANY_ID = "company-a";
const DATE_FROM = "2026-08-01";
const DATE_TO = "2026-08-13";
const FY_START = "2026-03-01";

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: 1, companyId: COMPANY_ID, customerId: 1, orderId: null, deliveryId: null,
    invoiceNumber: "INV1", documentType: "Invoice", invoiceDate: "2026-06-01", dueDate: "2026-06-15",
    vatTreatmentCode: "", status: "Posted", journalId: null, subtotal: 100, vatAmount: 0, total: 100,
    outstanding: 100, isRecurringTemplate: false, recurrencePattern: "", reference: "", notes: "",
    createdAt: "2026-06-01T00:00:00Z", submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null,
    postedAt: null, cancelledBy: null, cancelledAt: null,
    ...overrides,
  } as SalesInvoice;
}

function supplier(id: number, name: string): Supplier {
  return {
    id, companyId: COMPANY_ID, name, alternativeNames: [], defaultGlAccount: null, defaultVatCode: null,
    status: "Active", supplierCode: "", supplierCategory: "", supplierType: "Company", bankName: "",
    bankAccountNumber: "", bankBranchCode: "", vatNumber: "", taxNumber: "", riskRating: "Low",
    paymentTermsDays: 30, spendingLimit: 0,
  };
}

function bill(supplierId: number, total: number) {
  return { supplierId, total } as never;
}

function vatDoc(overrides: Partial<VatDocument> = {}): VatDocument {
  return {
    id: 1, documentType: "Invoice", partyId: 1, partyName: "Acme", partyVatNumber: "4123456789",
    date: "2026-06-01", vatTreatmentCode: "STD", vatType: "Standard", grossAmount: 115, vatAmount: 15,
    ...overrides,
  };
}

function vatTreatment(overrides: Partial<VatTreatment> = {}): VatTreatment {
  return { id: 10, companyId: COMPANY_ID, code: "STD", name: "Standard Rated", rate: 15, vatType: "Standard", isActive: true, createdAt: "2025-01-01T00:00:00Z", ...overrides };
}

function rateHistoryEntry(overrides: Partial<VatRateHistoryEntry> = {}): VatRateHistoryEntry {
  return { id: 1, vatTreatmentId: 10, rate: 15, effectiveFrom: "2020-01-01", effectiveTo: null, createdAt: "2020-01-01T00:00:00Z", createdBy: "System", ...overrides };
}

function automationTask(overrides: Partial<import("@/server/automation/types").AutomationTask> = {}): import("@/server/automation/types").AutomationTask {
  return {
    id: 1, companyId: COMPANY_ID, taskType: "RuleEngineRun", referenceId: null, name: "Rule Engine Run",
    status: "Failed", nextRunAt: "2026-08-14T00:00:00Z", lastRunAt: "2026-08-13T00:00:00Z", lastRunStatus: "Failed",
    lastRunDurationMs: 100, retryCount: 3, maxRetries: 3, isActive: true, createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getFinancialIntelligence).mockReset().mockResolvedValue({
    generatedAt: DATE_TO, dateFrom: DATE_FROM, dateTo: DATE_TO,
    largestMovements: [], possibleDuplicateJournals: [], missingPostings: [], unusualGrowth: [], truncated: false,
  });
  vi.mocked(listBankingExceptions).mockReset().mockResolvedValue([]);
  vi.mocked(listVatExceptions).mockReset().mockResolvedValue([]);
  vi.mocked(listVatReturns).mockReset().mockResolvedValue([]);
  vi.mocked(getBalanceSheet).mockReset().mockResolvedValue({
    isBalanced: true, totalAssets: 100, liabilities: { total: 50, lines: [] }, assets: { lines: [] },
  } as never);
  vi.mocked(getCashflowForecast).mockReset().mockResolvedValue({ forecast: [], confidence: 0 } as never);
  vi.mocked(getIncomeStatement).mockReset().mockResolvedValue({ revenue: { total: 0 }, netProfit: 0, grossProfit: 0 } as never);
  vi.mocked(listSalesInvoices).mockReset().mockResolvedValue([]);
  vi.mocked(listSuppliers).mockReset().mockResolvedValue([]);
  vi.mocked(listPurchaseBills).mockReset().mockResolvedValue([]);
  vi.mocked(listVatTreatments).mockReset().mockResolvedValue([]);
  vi.mocked(listVatDocuments).mockReset().mockResolvedValue([]);
  vi.mocked(listRateHistoryForCompany).mockReset().mockResolvedValue(new Map());
  vi.mocked(listAutomationTasks).mockReset().mockResolvedValue([]);
});

describe("getExecutiveIntelligence — Business Risk Score (Phase 25B, Part A)", () => {
  it("counts real overdue debtor invoices instead of a hardcoded zero", async () => {
    vi.mocked(listSalesInvoices).mockResolvedValue([
      invoice({ id: 1, outstanding: 100, dueDate: "2026-07-01" }), // overdue
      invoice({ id: 2, outstanding: 200, dueDate: "2026-07-05" }), // overdue
      invoice({ id: 3, outstanding: 0, dueDate: "2026-07-01" }), // fully paid, not overdue
      invoice({ id: 4, outstanding: 50, dueDate: "2026-09-01" }), // not yet due
      invoice({ id: 5, outstanding: 50, dueDate: null }), // no due date, never counted overdue
      invoice({ id: 6, outstanding: 50, dueDate: "2026-07-01", documentType: "Credit Note" }), // excluded
    ]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    // overdueDebtorsCount=2 * weight 2 = 4 (no other weighted inputs present)
    expect(report.businessRiskScore).toBe(4);
  });

  it("flags supplier concentration risk via the existing detectSupplierRisk check, not a hardcoded zero", async () => {
    vi.mocked(listSuppliers).mockResolvedValue([supplier(1, "Acme Supplies")]);
    vi.mocked(listPurchaseBills).mockResolvedValue([bill(1, 800), bill(1, 200)]); // 100% concentration

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    // supplierConcentrationRiskCount=1 * weight 6 = 6
    expect(report.businessRiskScore).toBe(6);
  });

  it("does not flag supplier concentration when spend is spread below the 40% threshold", async () => {
    vi.mocked(listSuppliers).mockResolvedValue([supplier(1, "A"), supplier(2, "B"), supplier(3, "C")]);
    vi.mocked(listPurchaseBills).mockResolvedValue([bill(1, 34), bill(2, 33), bill(3, 33)]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    expect(report.businessRiskScore).toBe(0);
  });

  it("combines overdue debtors and supplier concentration with the existing other inputs, matching the documented formula", async () => {
    vi.mocked(listSalesInvoices).mockResolvedValue([invoice({ id: 1, outstanding: 100, dueDate: "2026-07-01" })]);
    vi.mocked(listSuppliers).mockResolvedValue([supplier(1, "Acme")]);
    vi.mocked(listPurchaseBills).mockResolvedValue([bill(1, 1000)]);
    vi.mocked(listBankingExceptions).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    vi.mocked(listVatExceptions).mockResolvedValue([{ id: 1 }] as never);
    vi.mocked(getFinancialIntelligence).mockResolvedValue({
      generatedAt: DATE_TO, dateFrom: DATE_FROM, dateTo: DATE_TO, largestMovements: [], missingPostings: [], unusualGrowth: [],
      possibleDuplicateJournals: [{ accountId: 1, accountCode: "1000", postingDate: DATE_TO, side: "Debit", amount: 10, occurrences: [], reasoning: "" }],
      truncated: false,
    });

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    // openBankingExceptionCount=2*3 + openVatExceptionCount=1*4 + overdueDebtorsCount=1*2
    // + supplierConcentrationRiskCount=1*6 + duplicateTransactionSuspectCount=1*5 = 6+4+2+6+5 = 23
    expect(report.businessRiskScore).toBe(23);
  });

  it("reports a zero Business Risk Score when there is genuinely no risk signal in any input", async () => {
    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);
    expect(report.businessRiskScore).toBe(0);
  });
});

describe("getExecutiveIntelligence — Business Risk Score (Phase 25C, Part A: highRiskVatTransactionCount)", () => {
  it("counts real high-risk VAT documents via the existing VAT Intelligence definition, instead of a hardcoded zero", async () => {
    vi.mocked(listVatDocuments).mockResolvedValue([
      vatDoc({ id: 1 }), // clean — not high-risk
      vatDoc({ id: 2, vatTreatmentCode: "", vatType: null, grossAmount: 500 }), // missing VAT treatment — confidence 95, high-risk alone
    ]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    // highRiskVatTransactionCount=1 * weight 5 = 5
    expect(report.businessRiskScore).toBe(5);
  });

  it("uses the exact same isHighRisk composite (2+ signals, or one at 90+ confidence) — a document with only one low-confidence signal is not counted", async () => {
    vi.mocked(listVatDocuments).mockResolvedValue([
      // Missing VAT number only (confidence 75, single signal) — below the isHighRisk bar.
      vatDoc({ id: 1, partyVatNumber: null, vatAmount: 15 }),
    ]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    expect(report.businessRiskScore).toBe(0);
  });

  it("counts a document as high-risk once it accumulates 2 independent signals, matching isHighRisk exactly", async () => {
    vi.mocked(listVatDocuments).mockResolvedValue([
      // Missing VAT number (75) AND an incorrect VAT code for its type (85) — 2 signals.
      vatDoc({ id: 1, partyVatNumber: null, vatType: "ZeroRated", vatAmount: 15 }),
    ]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    expect(report.businessRiskScore).toBe(5);
  });

  it("reports zero real risk score when the VAT document set has no genuine issue — never a fabricated count", async () => {
    vi.mocked(listVatDocuments).mockResolvedValue([vatDoc({ id: 1 }), vatDoc({ id: 2 })]);
    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);
    expect(report.businessRiskScore).toBe(0);
  });

  it("leaves the scoring formula and every other weight unchanged — combines with the other real inputs additively", async () => {
    vi.mocked(listVatDocuments).mockResolvedValue([vatDoc({ id: 2, vatTreatmentCode: "", vatType: null, grossAmount: 500 })]);
    vi.mocked(listSalesInvoices).mockResolvedValue([invoice({ id: 1, outstanding: 100, dueDate: "2026-07-01" })]);
    vi.mocked(listSuppliers).mockResolvedValue([supplier(1, "Acme")]);
    vi.mocked(listPurchaseBills).mockResolvedValue([bill(1, 1000)]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    // highRiskVatTransactionCount=1*5 + overdueDebtorsCount=1*2 + supplierConcentrationRiskCount=1*6 = 5+2+6 = 13
    expect(report.businessRiskScore).toBe(13);
  });
});

describe("getExecutiveIntelligence — Business Risk Score (Phase 25K: date-aware detectVatRateConflict wiring)", () => {
  it("counts a document with a genuine, date-aware rate conflict once it combines with another VAT signal to cross the high-risk bar", async () => {
    vi.mocked(listVatTreatments).mockResolvedValue([vatTreatment({ id: 10, code: "STD", rate: 15 })]);
    vi.mocked(listRateHistoryForCompany).mockResolvedValue(new Map([[10, [rateHistoryEntry({ vatTreatmentId: 10, rate: 15, effectiveFrom: "2020-01-01", effectiveTo: null })]]]));
    vi.mocked(listVatDocuments).mockResolvedValue([
      // Missing VAT number (75, via detectMissingVatNumber) AND a VAT
      // amount that doesn't reconcile with the 15% rate actually in
      // effect on this document's own date (80, via detectVatRateConflict)
      // — 2 independent signals, crossing the isHighRisk bar together.
      vatDoc({ id: 1, vatTreatmentCode: "STD", date: "2026-06-01", grossAmount: 115, vatAmount: 5, partyVatNumber: null }),
    ]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    // highRiskVatTransactionCount=1 * weight 5 = 5
    expect(report.businessRiskScore).toBe(5);
  });

  it("does not count a document whose VAT amount genuinely matches the rate in effect on its own date — no false positive", async () => {
    vi.mocked(listVatTreatments).mockResolvedValue([vatTreatment({ id: 10, code: "STD", rate: 15 })]);
    vi.mocked(listRateHistoryForCompany).mockResolvedValue(new Map([[10, [rateHistoryEntry({ vatTreatmentId: 10, rate: 15, effectiveFrom: "2020-01-01", effectiveTo: null })]]]));
    vi.mocked(listVatDocuments).mockResolvedValue([
      // 115 gross at 15% => 15.00 VAT exactly — reconciles, no rate-conflict signal.
      // partyVatNumber present too, so no missing-vat-number signal either.
      vatDoc({ id: 1, vatTreatmentCode: "STD", date: "2026-06-01", grossAmount: 115, vatAmount: 15, partyVatNumber: "4123456789" }),
    ]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    expect(report.businessRiskScore).toBe(0);
  });

  it("resolves the rate that was actually in effect on the document's own date, not today's superseding rate — avoids the false-positive detectSuspiciousVatValues alone would risk", async () => {
    vi.mocked(listVatTreatments).mockResolvedValue([vatTreatment({ id: 10, code: "STD", rate: 15 })]);
    // Rate was 14% until 2026-03-31, then rose to 15% from 2026-04-01.
    vi.mocked(listRateHistoryForCompany).mockResolvedValue(
      new Map([[10, [
        rateHistoryEntry({ id: 1, vatTreatmentId: 10, rate: 14, effectiveFrom: "2020-01-01", effectiveTo: "2026-03-31" }),
        rateHistoryEntry({ id: 2, vatTreatmentId: 10, rate: 15, effectiveFrom: "2026-04-01", effectiveTo: null }),
      ]]]),
    );
    vi.mocked(listVatDocuments).mockResolvedValue([
      // Dated before the rate change, correctly using the 14% rate that
      // was actually in effect that day — detectVatRateConflict (date-aware)
      // must not flag this even though today's rate is now 15%.
      vatDoc({ id: 1, vatTreatmentCode: "STD", date: "2026-02-01", grossAmount: 114, vatAmount: 14, partyVatNumber: "4123456789" }),
    ]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    expect(report.businessRiskScore).toBe(0);
  });
});

describe("getExecutiveIntelligence — Audit Readiness Score (overnight cleanup — failedAutomationTaskCount)", () => {
  it("counts real failed automation tasks instead of a hardcoded zero", async () => {
    vi.mocked(listAutomationTasks).mockResolvedValue([automationTask({ id: 1, status: "Failed" }), automationTask({ id: 2, status: "Failed" })]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    // 100 - failedAutomationTaskCount=2*3 = 94
    expect(report.auditReadinessScore).toBe(94);
  });

  it("does not deduct for tasks that are not Failed", async () => {
    vi.mocked(listAutomationTasks).mockResolvedValue([automationTask({ id: 1, status: "Queued" }), automationTask({ id: 2, status: "Running" })]);

    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);

    expect(report.auditReadinessScore).toBe(100);
  });

  it("reports a perfect Audit Readiness Score when there is genuinely no issue at all", async () => {
    const report = await getExecutiveIntelligence(COMPANY_ID, DATE_FROM, DATE_TO, FY_START);
    expect(report.auditReadinessScore).toBe(100);
  });
});
