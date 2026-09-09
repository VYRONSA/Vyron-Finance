import { describe, expect, it } from "vitest";
import {
  buildAccountingPoliciesNote,
  buildCommitmentsAndContingenciesNote,
  buildEstimatesNote,
  buildEventsAfterReportingDateNote,
  buildExpenseNotes,
  buildFixedAssetNotes,
  buildInventoryNotes,
  buildRelatedPartyNote,
  buildRevenueNotes,
  buildSignificantJudgementsNote,
  buildVatNotes,
} from "./disclosure-engine";
import type { FixedAsset } from "@/server/assets/types";
import type { AssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";
import type { InventoryDashboardSummary } from "@/server/services/inventory-summary-service";
import type { VatDashboardSummary } from "@/server/services/vat-summary-service";
import type { IncomeStatement } from "@/server/reporting/income-statement-engine";
import type { VatReturn } from "@/server/vat/types";

function fixedAsset(overrides: Partial<FixedAsset> = {}): FixedAsset {
  return {
    id: 1, companyId: "co_1", assetNumber: "FA000001", description: "Delivery Vehicle", assetClassId: null,
    category: "Vehicles", assetGroup: "", purchaseDate: "2024-01-01", inServiceDate: "2024-01-01",
    cost: 120000, residualValue: 12000, usefulLifeMonths: 60, depreciationMethod: "StraightLine",
    diminishingBalanceRatePercent: 0, unitsOfProductionLifeUnits: 0, unitsOfProductionUnitsToDate: 0,
    accumulatedDepreciation: 18000, accumulatedImpairment: 0, supplierId: null, branchId: null,
    departmentId: null, costCentreId: null, projectId: null, location: "", custodian: "",
    status: "Active", statusChangedAt: "2024-01-01T00:00:00Z", serialNumber: "", warrantyExpiryDate: null,
    insuranceProvider: "", insurancePolicyNumber: "", insuranceExpiryDate: null, imageUrl: "", documentUrl: "",
    acquisitionJournalId: null, createdBy: "System", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const ASSET_SUMMARY: AssetDashboardSummary = {
  totalAssetValue: 120000, netBookValue: 102000, depreciationThisMonth: 1800,
  assetsDueForReplacementCount: 0, warrantyExpiryCount: 0, impairmentAlertCount: 0, assetHealthScore: 92,
};

const INVENTORY_SUMMARY: InventoryDashboardSummary = {
  inventoryValue: 50000, stockOnHandUnits: 500, activeItemCount: 20, lowStockCount: 2, outOfStockCount: 0, reorderAlertCount: 2, deadStockCount: 0, topMovingProducts: [],
};

const VAT_SUMMARY: VatDashboardSummary = { vatPayable: 15000, vatReceivable: 0, draftReturnCount: 0, openExceptionCount: 0, complianceScorePercent: 95, highRiskTransactionCount: 0 };

const INCOME_STATEMENT: IncomeStatement = {
  periodStart: "2026-05-01", periodEnd: "2026-05-31",
  revenue: { label: "Revenue", lines: [{ accountId: 1, accountCode: "4000", description: "Sales", reportingGroup: "", amount: 100000 }], total: 100000 },
  costOfSales: { label: "Cost of Sales", lines: [], total: 40000 },
  grossProfit: 60000,
  operatingExpenses: { label: "Operating Expenses", lines: [{ accountId: 2, accountCode: "6000", description: "Salaries", reportingGroup: "", amount: 20000 }], total: 20000 },
  operatingProfit: 40000,
  otherIncome: { label: "Other Income", lines: [], total: 0 },
  otherExpense: { label: "Other Expense", lines: [], total: 0 },
  netProfit: 40000,
};

describe("buildAccountingPoliciesNote", () => {
  it("states the real FIFO/depreciation/VAT facts it was given and still requires narrative confirmation", () => {
    const note = buildAccountingPoliciesNote(["StraightLine"], ["Standard Rated"]);
    expect(note.content.facts.some((f) => f.includes("FIFO"))).toBe(true);
    expect(note.content.facts.some((f) => f.includes("StraightLine"))).toBe(true);
    expect(note.requiresUserInput).toBe(true);
  });
});

describe("buildSignificantJudgementsNote / buildRelatedPartyNote / buildCommitmentsAndContingenciesNote / buildEventsAfterReportingDateNote", () => {
  it("are honest placeholders with no fabricated facts", () => {
    expect(buildSignificantJudgementsNote().content.facts).toHaveLength(0);
    expect(buildSignificantJudgementsNote().requiresUserInput).toBe(true);
    expect(buildRelatedPartyNote().requiresUserInput).toBe(true);
    expect(buildCommitmentsAndContingenciesNote().requiresUserInput).toBe(true);
    const events = buildEventsAfterReportingDateNote("2026-05-31");
    expect(events.requiresUserInput).toBe(true);
    expect(events.content.placeholders[0]).toContain("2026-05-31");
  });
});

describe("buildEstimatesNote", () => {
  it("derives a real useful-life range when assets exist", () => {
    const note = buildEstimatesNote([36, 60, 120]);
    expect(note.content.facts[0]).toContain("36");
    expect(note.content.facts[0]).toContain("120");
  });

  it("has no fabricated useful-life fact when no assets exist", () => {
    const note = buildEstimatesNote([]);
    expect(note.content.facts).toHaveLength(0);
  });
});

describe("buildFixedAssetNotes", () => {
  it("derives real facts from the Asset Dashboard Summary and asset register, grouped by depreciation method", () => {
    const note = buildFixedAssetNotes([fixedAsset(), fixedAsset({ id: 2, depreciationMethod: "DiminishingBalance" })], ASSET_SUMMARY);
    expect(note.content.facts.some((f) => f.includes("120000"))).toBe(true);
    expect(note.content.facts.some((f) => f.includes("StraightLine"))).toBe(true);
    expect(note.content.facts.some((f) => f.includes("DiminishingBalance"))).toBe(true);
    expect(note.requiresUserInput).toBe(false);
  });

  it("flags open Impairment Indicator findings as requiring confirmation", () => {
    const note = buildFixedAssetNotes([fixedAsset()], { ...ASSET_SUMMARY, impairmentAlertCount: 2 });
    expect(note.requiresUserInput).toBe(true);
  });
});

describe("buildInventoryNotes", () => {
  it("derives real facts and has no placeholder when there's no dead stock", () => {
    const note = buildInventoryNotes(INVENTORY_SUMMARY);
    expect(note.content.facts.some((f) => f.includes("50000"))).toBe(true);
    expect(note.requiresUserInput).toBe(false);
  });

  it("flags dead stock as requiring a write-down confirmation", () => {
    const note = buildInventoryNotes({ ...INVENTORY_SUMMARY, deadStockCount: 3 });
    expect(note.requiresUserInput).toBe(true);
  });
});

describe("buildVatNotes", () => {
  it("derives real facts from the VAT Dashboard Summary and latest return", () => {
    const vatReturn: VatReturn = {
      id: 1, companyId: "co_1", periodStart: "2026-05-01", periodEnd: "2026-05-31", status: "Approved",
      totalOutputVat: 30000, totalInputVat: 15000, netPayable: 15000, settlementJournalId: null,
      isAmendment: false, amendedReturnId: null, sarsReference: null, submissionMethod: "Manual",
      submittedAt: null, approvedBy: null,
    } as VatReturn;
    const note = buildVatNotes(VAT_SUMMARY, vatReturn);
    expect(note.content.facts.some((f) => f.includes("15000"))).toBe(true);
    expect(note.requiresUserInput).toBe(false);
  });
});

describe("buildRevenueNotes / buildExpenseNotes", () => {
  it("derives real per-line facts from the Income Statement", () => {
    const revenue = buildRevenueNotes(INCOME_STATEMENT);
    expect(revenue.content.facts.some((f) => f.includes("4000"))).toBe(true);
    const expenses = buildExpenseNotes(INCOME_STATEMENT);
    expect(expenses.content.facts.some((f) => f.includes("6000"))).toBe(true);
    expect(expenses.requiresUserInput).toBe(true); // no Payroll module — disclosed
  });
});
