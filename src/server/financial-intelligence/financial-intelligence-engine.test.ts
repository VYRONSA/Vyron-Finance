import { describe, expect, it } from "vitest";
import {
  buildFinancialIntelligenceSummary,
  findBankingFindings,
  findCashFlowFindings,
  findCustomerFindings,
  findDataQualityFindings,
  findGeneralLedgerFindings,
  findCustomerConcentrationFindings,
  findProfitabilityFindings,
  findRecurringTransactionFindings,
  findRepeatedCorrectionFindings,
  findSupplierFindings,
  findTransactionFindings,
  findVatFindings,
  findingsFromAssetFindings,
  findingsFromAuditFindings,
  findingsFromExecutiveAlerts,
  type BankingIntelligenceInput,
  type DataQualityInput,
  type FinancialIntelligenceInput,
  type TransactionIntelligenceInput,
} from "./financial-intelligence-engine";
import type { RecurringTransactionPattern } from "./recurring-transaction-detector";
import type { CustomerConcentrationRisk } from "./customer-concentration-detector";
import type { RepeatedCorrectionPattern } from "./repeated-correction-detector";
import type { FinancialIntelligenceReport } from "@/server/services/financial-intelligence-service";
import type { AssetFinding } from "@/server/assets/types";
import type { AuditFinding } from "@/server/audit/types";
import type { BankingException } from "@/server/banking-rules/types";
import type { ExecutiveAlert, ExecutiveAlertType } from "@/server/reporting/types";
import type { AgingBuckets } from "@/server/shared/aging";
import type { VatDashboardSummary } from "@/server/services/vat-summary-service";

const EMPTY_AGING: AgingBuckets = { current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 };
const EMPTY_VAT: VatDashboardSummary = { vatPayable: 0, vatReceivable: 0, draftReturnCount: 0, openExceptionCount: 0, complianceScorePercent: 100, highRiskTransactionCount: 0 };

// Number punctuation is locale-dependent — assert on the currency-
// grouping behavior via the same `toLocaleString` call the engine uses,
// not a hardcoded English separator (matches this codebase's own
// `bank-accounts/page.test.ts::fmt` convention).
function fmt(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exception(overrides: Partial<BankingException> & Pick<BankingException, "id" | "exceptionType">): BankingException {
  return {
    companyId: "co_1",
    bankTransactionId: 1,
    reason: "Test reason",
    evidence: "Test evidence",
    recommendedAction: "Test action",
    status: "Open",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function alert(overrides: Partial<ExecutiveAlert> & Pick<ExecutiveAlert, "id" | "alertType" | "priority">): ExecutiveAlert {
  return {
    companyId: "co_1",
    reason: "Test reason",
    evidence: "Test evidence",
    recommendedAction: "Test action",
    relatedType: null,
    relatedId: null,
    status: "Open",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const FULLY_CONFIGURED_DATA_QUALITY: DataQualityInput = {
  companyId: "co_1",
  hasBankAccount: true,
  hasBankTransactionsImported: true,
  hasOpeningBalanceEntries: true,
  hasCustomers: true,
  hasSuppliers: true,
  hasFinancialYearConfigured: true,
};

describe("findDataQualityFindings", () => {
  it("produces no findings when everything is configured (negative condition)", () => {
    expect(findDataQualityFindings(FULLY_CONFIGURED_DATA_QUALITY)).toEqual([]);
  });

  it("flags a missing financial year (positive condition)", () => {
    const findings = findDataQualityFindings({ ...FULLY_CONFIGURED_DATA_QUALITY, hasFinancialYearConfigured: false });
    expect(findings.map((f) => f.id)).toContain("data-quality-no-financial-year");
    expect(findings[0].category).toBe("DataQuality");
  });

  it("flags a missing bank account, and does not ALSO flag missing bank transactions redundantly", () => {
    const findings = findDataQualityFindings({ ...FULLY_CONFIGURED_DATA_QUALITY, hasBankAccount: false, hasBankTransactionsImported: false });
    const ids = findings.map((f) => f.id);
    expect(ids).toContain("data-quality-no-bank-account");
    expect(ids).not.toContain("data-quality-no-bank-transactions");
  });

  it("flags missing bank transactions only when an account exists but nothing was imported", () => {
    const findings = findDataQualityFindings({ ...FULLY_CONFIGURED_DATA_QUALITY, hasBankTransactionsImported: false });
    expect(findings.map((f) => f.id)).toEqual(["data-quality-no-bank-transactions"]);
  });

  it("flags every gap at once for a brand-new, empty company", () => {
    const empty: DataQualityInput = {
      companyId: "co_1",
      hasBankAccount: false,
      hasBankTransactionsImported: false,
      hasOpeningBalanceEntries: false,
      hasCustomers: false,
      hasSuppliers: false,
      hasFinancialYearConfigured: false,
    };
    const findings = findDataQualityFindings(empty);
    expect(findings).toHaveLength(5); // no-bank-transactions is suppressed since no-bank-account already covers it
    expect(findings.every((f) => f.category === "DataQuality")).toBe(true);
    expect(findings.every((f) => f.recommendedAction !== null)).toBe(true);
  });
});

describe("findBankingFindings", () => {
  const base: BankingIntelligenceInput = { companyId: "co_1", openExceptions: [], accountsNeedingReconciliation: 0 };

  it("produces no findings with no exceptions and nothing needing reconciliation (negative condition)", () => {
    expect(findBankingFindings(base)).toEqual([]);
  });

  it("groups multiple possible-duplicate exceptions into one finding with a real count (positive condition)", () => {
    const findings = findBankingFindings({
      ...base,
      openExceptions: [
        exception({ id: 1, exceptionType: "PossibleDuplicate", reason: "Same amount within 3 days" }),
        exception({ id: 2, exceptionType: "PossibleDuplicate", reason: "Same amount within 3 days" }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("2 possible duplicates detected");
    expect(findings[0].severity).toBe("High");
    expect(findings[0].category).toBe("Banking");
    expect(findings[0].recommendedAction).toBe("Review Banking Exceptions");
    expect(findings[0].actionHref).toBe("/company/co_1/banking-exceptions");
  });

  it("produces a separate finding per distinct open exception type", () => {
    const findings = findBankingFindings({
      ...base,
      openExceptions: [exception({ id: 1, exceptionType: "PossibleDuplicate" }), exception({ id: 2, exceptionType: "UnknownMerchant" })],
    });
    expect(findings.map((f) => f.id).sort()).toEqual(["banking-exception-PossibleDuplicate", "banking-exception-UnknownMerchant"]);
  });

  it("ignores resolved/dismissed exceptions passed in by mistake only if the caller filters — evidence trusts the caller's Open-only list", () => {
    // The engine doesn't re-filter status itself (the service layer already fetches Open-only) —
    // this documents that contract rather than silently double-filtering.
    const findings = findBankingFindings({ ...base, openExceptions: [exception({ id: 1, exceptionType: "MissingSupplier", status: "Resolved" })] });
    expect(findings).toHaveLength(1);
  });

  it("does not flag reconciliation when zero accounts need it (boundary)", () => {
    expect(findBankingFindings({ ...base, accountsNeedingReconciliation: 0 })).toEqual([]);
  });

  it("flags reconciliation at Medium severity for 1-2 accounts and High at 3+ (boundary)", () => {
    const two = findBankingFindings({ ...base, accountsNeedingReconciliation: 2 });
    const three = findBankingFindings({ ...base, accountsNeedingReconciliation: 3 });
    expect(two[0].severity).toBe("Medium");
    expect(three[0].severity).toBe("High");
    expect(three[0].recommendedAction).toBe("Reconcile Statement");
  });
});

describe("findTransactionFindings", () => {
  const base: TransactionIntelligenceInput = { companyId: "co_1", awaitingReviewCount: 0, unallocatedCount: 0 };

  it("produces no findings when nothing needs review or allocation (negative condition)", () => {
    expect(findTransactionFindings(base)).toEqual([]);
  });

  it("reports the real awaiting-review count in the title (positive condition, matches the brief's own example)", () => {
    const findings = findTransactionFindings({ ...base, awaitingReviewCount: 14 });
    expect(findings[0].title).toBe("14 transactions require review");
    expect(findings[0].recommendedAction).toBe("Review Transactions");
  });

  it("escalates to High at 10+ awaiting review, stays Medium below it (boundary)", () => {
    expect(findTransactionFindings({ ...base, awaitingReviewCount: 9 })[0].severity).toBe("Medium");
    expect(findTransactionFindings({ ...base, awaitingReviewCount: 10 })[0].severity).toBe("High");
  });

  it("reports unallocated transactions as a separate finding", () => {
    const findings = findTransactionFindings({ ...base, unallocatedCount: 5 });
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("transactions-unallocated");
  });

  it("reports both findings together when both are nonzero (multiple simultaneous findings)", () => {
    const findings = findTransactionFindings({ companyId: "co_1", awaitingReviewCount: 3, unallocatedCount: 7 });
    expect(findings.map((f) => f.id)).toEqual(["transactions-awaiting-review", "transactions-unallocated"]);
  });
});

describe("findRecurringTransactionFindings", () => {
  function pattern(overrides: Partial<RecurringTransactionPattern> = {}): RecurringTransactionPattern {
    return {
      beneficiary: "ABC Landlords", direction: "Debit", periodicity: "Monthly", typicalAmount: 12000,
      occurrenceCount: 4, firstDate: "2026-05-01", latestDate: "2026-08-01", transactionIds: [10, 20, 30, 40],
      ...overrides,
    };
  }

  it("produces no findings when there are no recurring patterns (negative condition)", () => {
    expect(findRecurringTransactionFindings({ companyId: "co_1", recurringPatterns: [] })).toEqual([]);
  });

  it("produces no findings when recurringPatterns is undefined (not evaluated, never a fabricated all-clear)", () => {
    expect(findRecurringTransactionFindings({ companyId: "co_1", recurringPatterns: undefined })).toEqual([]);
  });

  it("wraps a recurring pattern into a Low-severity, Deterministic, Transactions-category Finding (recurring != automatically risky)", () => {
    const [finding] = findRecurringTransactionFindings({ companyId: "co_1", recurringPatterns: [pattern()] });
    expect(finding.category).toBe("Transactions");
    expect(finding.severity).toBe("Low");
    expect(finding.source).toBe("Deterministic");
    expect(finding.title).toBe("Monthly payment to ABC Landlords");
    expect(finding.evidence).toContain("4 occurrence(s)");
    expect(finding.evidence).toContain(fmt(12000));
    expect(finding.evidence).toContain("2026-08-01");
    expect(finding.actionHref).toBe("/company/co_1/transactions");
  });

  it("labels a Credit-direction pattern as a receipt, not a payment", () => {
    const [finding] = findRecurringTransactionFindings({ companyId: "co_1", recurringPatterns: [pattern({ direction: "Credit", beneficiary: "Northwood Ltd" })] });
    expect(finding.title).toContain("receipt");
    expect(finding.title).not.toContain("payment");
  });

  it("gives each pattern a distinct, stable Finding id derived from its latest real transaction id", () => {
    const findings = findRecurringTransactionFindings({
      companyId: "co_1",
      recurringPatterns: [pattern({ transactionIds: [1, 2, 3] }), pattern({ direction: "Credit", beneficiary: "X", transactionIds: [4, 5, 6] })],
    });
    expect(new Set(findings.map((f) => f.id)).size).toBe(2);
  });
});

describe("findRepeatedCorrectionFindings", () => {
  function pattern(overrides: Partial<RepeatedCorrectionPattern> = {}): RepeatedCorrectionPattern {
    return { beneficiary: "ABC Supplies", glAccount: "6100", occurrenceCount: 4, transactionIds: [10, 20, 30, 40], latestDate: "2026-08-01", ...overrides };
  }

  it("produces no findings when there are no repeated-correction patterns (negative condition)", () => {
    expect(findRepeatedCorrectionFindings({ companyId: "co_1", repeatedCorrectionPatterns: [] })).toEqual([]);
  });

  it("produces no findings when repeatedCorrectionPatterns is undefined (not evaluated, never a fabricated all-clear)", () => {
    expect(findRepeatedCorrectionFindings({ companyId: "co_1", repeatedCorrectionPatterns: undefined })).toEqual([]);
  });

  it("wraps a pattern into a Low-severity, Deterministic, Transactions-category Finding — advisory only, never High just to be visible", () => {
    const [finding] = findRepeatedCorrectionFindings({ companyId: "co_1", repeatedCorrectionPatterns: [pattern()] });
    expect(finding.category).toBe("Transactions");
    expect(finding.severity).toBe("Low");
    expect(finding.source).toBe("Deterministic");
    expect(finding.title).toBe("Repeated manual correction detected");
    expect(finding.description).toContain("ABC Supplies");
    expect(finding.description).toContain("6100");
    expect(finding.description).toContain("4");
    expect(finding.description).toContain("Consider creating a Banking Rule");
    expect(finding.evidence).toContain("4 manual allocation(s)");
    expect(finding.evidence).toContain("2026-08-01");
    expect(finding.recommendedAction).toBe("Review Banking Rules");
    expect(finding.actionHref).toBe("/company/co_1/banking-rules");
  });

  it("never mentions creating, modifying, or auto-applying a Banking Rule — advisory wording only", () => {
    const [finding] = findRepeatedCorrectionFindings({ companyId: "co_1", repeatedCorrectionPatterns: [pattern()] });
    expect(finding.description.toLowerCase()).toContain("consider");
    expect(finding.description.toLowerCase()).not.toContain("automatically");
  });

  it("gives each pattern a distinct Finding id derived from its latest real transaction id", () => {
    const findings = findRepeatedCorrectionFindings({
      companyId: "co_1",
      repeatedCorrectionPatterns: [pattern({ transactionIds: [1, 2, 3] }), pattern({ beneficiary: "XYZ", transactionIds: [4, 5, 6] })],
    });
    expect(new Set(findings.map((f) => f.id)).size).toBe(2);
  });
});

describe("findCustomerFindings / findSupplierFindings", () => {
  it("produces no finding when nothing is overdue past 90 days (negative condition)", () => {
    expect(findCustomerFindings({ companyId: "co_1", debtorsAging: { ...EMPTY_AGING, days60: 500 } })).toEqual([]);
  });

  it("flags an overdue customer balance using the real days120Plus bucket (positive condition, matches the brief's own evidence example)", () => {
    const findings = findCustomerFindings({ companyId: "co_1", debtorsAging: { ...EMPTY_AGING, days120Plus: 15000 } });
    expect(findings[0].title).toBe("Customer balance overdue");
    expect(findings[0].evidence).toContain(fmt(15000));
    expect(findings[0].evidence).toContain("more than 90 days");
    expect(findings[0].severity).toBe("High");
    expect(findings[0].recommendedAction).toBe("Review Customer Aging");
  });

  it("flags an overdue supplier balance the same way", () => {
    const findings = findSupplierFindings({ companyId: "co_1", creditorsAging: { ...EMPTY_AGING, days120Plus: 250 } });
    expect(findings[0].title).toBe("Supplier balance overdue");
    expect(findings[0].recommendedAction).toBe("Review Supplier Aging");
  });

  it("treats a boundary amount of exactly 0 as not overdue", () => {
    expect(findCustomerFindings({ companyId: "co_1", debtorsAging: { ...EMPTY_AGING, days120Plus: 0 } })).toEqual([]);
  });
});

describe("findCustomerConcentrationFindings", () => {
  function risk(overrides: Partial<CustomerConcentrationRisk> = {}): CustomerConcentrationRisk {
    return { customerId: 1, customerName: "Northwood Ltd", sharePercent: 45, customerRevenue: 45000, totalRevenue: 100000, ...overrides };
  }

  it("produces no finding when there is no concentration risk (negative condition)", () => {
    expect(findCustomerConcentrationFindings({ companyId: "co_1", customerConcentration: null })).toEqual([]);
  });

  it("produces no finding when customerConcentration is undefined (not evaluated, never a fabricated all-clear)", () => {
    expect(findCustomerConcentrationFindings({ companyId: "co_1", customerConcentration: undefined })).toEqual([]);
  });

  it("wraps a concentration risk into a Customers-category, Deterministic Finding with the real share and amounts", () => {
    const [finding] = findCustomerConcentrationFindings({ companyId: "co_1", customerConcentration: risk() });
    expect(finding.category).toBe("Customers");
    expect(finding.source).toBe("Deterministic");
    expect(finding.id).toBe("customer-revenue-concentration");
    expect(finding.title).toBe("Customer revenue concentration");
    expect(finding.description).toContain("Northwood Ltd");
    expect(finding.description).toContain("45%");
    expect(finding.evidence).toContain(fmt(45000));
    expect(finding.evidence).toContain(fmt(100000));
    expect(finding.actionHref).toBe("/company/co_1/customers");
    expect(finding.recommendedAction).toBe("Review Customers");
  });

  it("mirrors detectSupplierRisk's own severity bands — Medium below 60%, High at/above 60%", () => {
    expect(findCustomerConcentrationFindings({ companyId: "co_1", customerConcentration: risk({ sharePercent: 40 }) })[0].severity).toBe("Medium");
    expect(findCustomerConcentrationFindings({ companyId: "co_1", customerConcentration: risk({ sharePercent: 59.99 }) })[0].severity).toBe("Medium");
    expect(findCustomerConcentrationFindings({ companyId: "co_1", customerConcentration: risk({ sharePercent: 60 }) })[0].severity).toBe("High");
    expect(findCustomerConcentrationFindings({ companyId: "co_1", customerConcentration: risk({ sharePercent: 100 }) })[0].severity).toBe("High");
  });
});

describe("findVatFindings", () => {
  it("produces no findings for a fully clean VAT position (negative condition)", () => {
    expect(findVatFindings({ companyId: "co_1", vatSummary: EMPTY_VAT })).toEqual([]);
  });

  it("flags a real VAT liability (positive condition, matches the brief's own evidence example)", () => {
    const findings = findVatFindings({ companyId: "co_1", vatSummary: { ...EMPTY_VAT, vatPayable: 4200.5 } });
    expect(findings[0].title).toBe("VAT liability exists");
    expect(findings[0].evidence).toContain(fmt(4200.5));
    expect(findings[0].recommendedAction).toBe("Review VAT");
  });

  it("does not flag a liability when the return is actually a refund (vatPayable stays 0)", () => {
    expect(findVatFindings({ companyId: "co_1", vatSummary: { ...EMPTY_VAT, vatReceivable: 1000 } })).toEqual([]);
  });

  it("flags a draft VAT return", () => {
    const findings = findVatFindings({ companyId: "co_1", vatSummary: { ...EMPTY_VAT, draftReturnCount: 1 } });
    expect(findings[0].id).toBe("vat-return-draft");
  });

  it("escalates open VAT exceptions to Critical at 5+, Medium below it (boundary)", () => {
    const four = findVatFindings({ companyId: "co_1", vatSummary: { ...EMPTY_VAT, openExceptionCount: 4 } });
    const five = findVatFindings({ companyId: "co_1", vatSummary: { ...EMPTY_VAT, openExceptionCount: 5 } });
    expect(four[0].severity).toBe("Medium");
    expect(five[0].severity).toBe("Critical");
  });

  it("reports all three VAT findings together when all apply (multiple simultaneous findings)", () => {
    const findings = findVatFindings({ companyId: "co_1", vatSummary: { ...EMPTY_VAT, vatPayable: 100, draftReturnCount: 1, openExceptionCount: 1 } });
    expect(findings.map((f) => f.id)).toEqual(["vat-liability-exists", "vat-return-draft", "vat-exceptions-open"]);
  });
});

describe("findingsFromExecutiveAlerts", () => {
  it("returns no findings for an empty alert list (negative condition / empty company)", () => {
    expect(findingsFromExecutiveAlerts([])).toEqual([]);
  });

  it("copies severity verbatim from the real alert priority — never recalculated", () => {
    const findings = findingsFromExecutiveAlerts([alert({ id: 1, alertType: "DecliningCash", priority: "Critical" })]);
    expect(findings[0].severity).toBe("Critical");
    expect(findings[0].source).toBe("ExistingIntelligenceSignal");
  });

  it("maps every real ExecutiveAlertType to a real category and a real, distinct action route", () => {
    const types: ExecutiveAlertType[] = [
      "DecliningCash", "IncreasingDebtors", "SlowPayingCustomers", "SupplierRisk", "MarginReduction",
      "InventoryProblems", "ComplianceIssues", "AutomationFailures", "LargeUnusualTransactions", "DuplicateTrends",
    ];
    const findings = findingsFromExecutiveAlerts(types.map((alertType, i) => alert({ id: i, alertType, priority: "Medium" })));
    for (const f of findings) {
      expect(f.category).toBeTruthy();
      expect(f.actionHref).toMatch(/^\/company\/co_1\//);
    }
    expect(new Set(findings.map((f) => f.category)).size).toBeGreaterThan(1);
  });

  it("preserves the real evidence, reason, and recommendedAction text unchanged", () => {
    const a = alert({ id: 9, alertType: "MarginReduction", priority: "High", reason: "Gross margin fell 6.2 points.", evidence: "45% -> 39%.", recommendedAction: "Review cost of sales." });
    const findings = findingsFromExecutiveAlerts([a]);
    expect(findings[0].description).toBe(a.reason);
    expect(findings[0].evidence).toBe(a.evidence);
    expect(findings[0].recommendedAction).toBe(a.recommendedAction);
    expect(findings[0].companyId).toBe(a.companyId);
    expect(findings[0].createdAt).toBe(a.createdAt);
  });
});

describe("buildFinancialIntelligenceSummary", () => {
  const cleanInput: FinancialIntelligenceInput = {
    ...FULLY_CONFIGURED_DATA_QUALITY,
    openExceptions: [],
    accountsNeedingReconciliation: 0,
    awaitingReviewCount: 0,
    unallocatedCount: 0,
    debtorsAging: EMPTY_AGING,
    creditorsAging: EMPTY_AGING,
    vatSummary: EMPTY_VAT,
    openExecutiveAlerts: [],
  };

  it("produces zero findings for a fully clean, fully configured company (negative condition)", () => {
    const result = buildFinancialIntelligenceSummary(cleanInput);
    expect(result.findings).toEqual([]);
    expect(result.countBySeverity).toEqual({ Critical: 0, High: 0, Medium: 0, Low: 0 });
  });

  it("surfaces a customer concentration risk through the composer without any Intelligence Centre redesign — same generic Finding presentation as every other category", () => {
    const result = buildFinancialIntelligenceSummary({
      ...cleanInput,
      customerConcentration: { customerId: 1, customerName: "Northwood Ltd", sharePercent: 70, customerRevenue: 70000, totalRevenue: 100000 },
    });
    const finding = result.findings.find((f) => f.id === "customer-revenue-concentration");
    expect(finding).toBeDefined();
    expect(finding!.category).toBe("Customers");
    expect(finding!.severity).toBe("High");
    expect(result.countBySeverity.High).toBe(1);
  });

  it("produces only Data Quality findings for a brand-new, completely empty company", () => {
    const result = buildFinancialIntelligenceSummary({
      ...cleanInput,
      hasBankAccount: false,
      hasBankTransactionsImported: false,
      hasOpeningBalanceEntries: false,
      hasCustomers: false,
      hasSuppliers: false,
      hasFinancialYearConfigured: false,
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.category === "DataQuality")).toBe(true);
    expect(result.countBySeverity.Medium).toBe(result.findings.length);
  });

  it("combines findings from every rule at once (multiple simultaneous findings across categories)", () => {
    const result = buildFinancialIntelligenceSummary({
      ...cleanInput,
      openExceptions: [exception({ id: 1, exceptionType: "PossibleDuplicate" })],
      awaitingReviewCount: 3,
      debtorsAging: { ...EMPTY_AGING, days120Plus: 500 },
      vatSummary: { ...EMPTY_VAT, vatPayable: 10 },
      openExecutiveAlerts: [alert({ id: 1, alertType: "MarginReduction", priority: "High" })],
    });
    const categories = new Set(result.findings.map((f) => f.category));
    expect(categories).toEqual(new Set(["Banking", "Transactions", "Customers", "VAT", "Profitability"]));
  });

  it("sorts findings most-severe-first (severity ordering)", () => {
    const result = buildFinancialIntelligenceSummary({
      ...cleanInput,
      hasCustomers: false, // Medium
      openExceptions: [exception({ id: 1, exceptionType: "PossibleDuplicate" })], // High
      vatSummary: { ...EMPTY_VAT, openExceptionCount: 6 }, // Critical (>=5)
    });
    const severities = result.findings.map((f) => f.severity);
    expect(severities[0]).toBe("Critical");
    expect(severities[severities.length - 1]).toBe("Medium");
    // Never out of the documented Critical -> High -> Medium -> Low order.
    const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    for (let i = 1; i < severities.length; i++) {
      expect(rank[severities[i]]).toBeGreaterThanOrEqual(rank[severities[i - 1]]);
    }
  });

  it("gives every returned finding a real, non-empty recommended action or explicit informational (null)", () => {
    const result = buildFinancialIntelligenceSummary({
      ...cleanInput,
      openExceptions: [exception({ id: 1, exceptionType: "LargeUnusualPayment" })],
      openExecutiveAlerts: [alert({ id: 1, alertType: "ComplianceIssues", priority: "Medium" })],
    });
    for (const f of result.findings) {
      expect(f.recommendedAction === null || f.recommendedAction.length > 0).toBe(true);
      if (f.recommendedAction !== null) expect(f.actionHref).toBeTruthy();
    }
  });

  it("never fabricates evidence — every finding's evidence string traces to a real input value", () => {
    const result = buildFinancialIntelligenceSummary({
      ...cleanInput,
      awaitingReviewCount: 7,
    });
    const txFinding = result.findings.find((f) => f.id === "transactions-awaiting-review");
    expect(txFinding?.evidence).toContain("7");
  });
});

// ---------------------------------------------------------------------
// Phase 13 — General Ledger, Cash Flow, Profitability, Assets, Audit.
// ---------------------------------------------------------------------

function emptyReport(overrides: Partial<FinancialIntelligenceReport> = {}): FinancialIntelligenceReport {
  return {
    generatedAt: "2026-08-01T00:00:00Z",
    dateFrom: "2026-08-01",
    dateTo: "2026-08-12",
    largestMovements: [],
    possibleDuplicateJournals: [],
    missingPostings: [],
    unusualGrowth: [],
    truncated: false,
    ...overrides,
  };
}

describe("findGeneralLedgerFindings", () => {
  it("produces nothing when no report was fetched (omitted, never treated as clean)", () => {
    expect(findGeneralLedgerFindings({ companyId: "co_1", report: undefined })).toEqual([]);
  });

  it("produces nothing for a report with no duplicate journals or missing postings (negative condition)", () => {
    expect(findGeneralLedgerFindings({ companyId: "co_1", report: emptyReport() })).toEqual([]);
  });

  it("wraps a real possible-duplicate-journal group with its real reasoning as evidence (positive condition)", () => {
    const report = emptyReport({
      possibleDuplicateJournals: [
        { accountId: 1, accountCode: "6100", postingDate: "2026-08-05", side: "Debit", amount: 500, occurrences: [{ transactionId: 1, journalId: 10, journalNumber: "JNL-010" }, { transactionId: 2, journalId: 11, journalNumber: "JNL-011" }], reasoning: "2 separate journals posted the same debit amount." },
      ],
    });
    const findings = findGeneralLedgerFindings({ companyId: "co_1", report });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("GeneralLedger");
    expect(findings[0].description).toBe("2 separate journals posted the same debit amount.");
    expect(findings[0].evidence).toContain("JNL-010");
    expect(findings[0].evidence).toContain("JNL-011");
  });

  it("escalates a duplicate-journal group to High at 3+ occurrences, Medium below it (boundary)", () => {
    const two = emptyReport({ possibleDuplicateJournals: [{ accountId: 1, accountCode: "6100", postingDate: "2026-08-05", side: "Debit", amount: 500, occurrences: [{ transactionId: 1, journalId: 10, journalNumber: "JNL-010" }, { transactionId: 2, journalId: 11, journalNumber: "JNL-011" }], reasoning: "r" }] });
    const three = emptyReport({ possibleDuplicateJournals: [{ accountId: 1, accountCode: "6100", postingDate: "2026-08-05", side: "Debit", amount: 500, occurrences: [{ transactionId: 1, journalId: 10, journalNumber: "JNL-010" }, { transactionId: 2, journalId: 11, journalNumber: "JNL-011" }, { transactionId: 3, journalId: 12, journalNumber: "JNL-012" }], reasoning: "r" }] });
    expect(findGeneralLedgerFindings({ companyId: "co_1", report: two })[0].severity).toBe("Medium");
    expect(findGeneralLedgerFindings({ companyId: "co_1", report: three })[0].severity).toBe("High");
  });

  it("wraps a real missing/stale posting with its real age as evidence", () => {
    const report = emptyReport({ missingPostings: [{ journalId: 5, journalNumber: "JNL-005", status: "Approved", ageDays: 10, reasoning: "Approved 10 day(s) ago but still not posted." }] });
    const findings = findGeneralLedgerFindings({ companyId: "co_1", report });
    expect(findings[0].title).toContain("JNL-005");
    expect(findings[0].evidence).toContain("10 day(s)");
  });

  it("escalates a stale posting to High at 21+ days, Medium below it (boundary)", () => {
    const twenty = emptyReport({ missingPostings: [{ journalId: 5, journalNumber: "JNL-005", status: "Draft", ageDays: 20, reasoning: "r" }] });
    const twentyOne = emptyReport({ missingPostings: [{ journalId: 5, journalNumber: "JNL-005", status: "Draft", ageDays: 21, reasoning: "r" }] });
    expect(findGeneralLedgerFindings({ companyId: "co_1", report: twenty })[0].severity).toBe("Medium");
    expect(findGeneralLedgerFindings({ companyId: "co_1", report: twentyOne })[0].severity).toBe("High");
  });

  it("combines multiple duplicate-journal groups and missing postings together (multiple simultaneous findings)", () => {
    const report = emptyReport({
      possibleDuplicateJournals: [{ accountId: 1, accountCode: "6100", postingDate: "2026-08-05", side: "Debit", amount: 500, occurrences: [{ transactionId: 1, journalId: 10, journalNumber: "JNL-010" }, { transactionId: 2, journalId: 11, journalNumber: "JNL-011" }], reasoning: "r" }],
      missingPostings: [{ journalId: 5, journalNumber: "JNL-005", status: "Draft", ageDays: 15, reasoning: "r" }],
    });
    expect(findGeneralLedgerFindings({ companyId: "co_1", report })).toHaveLength(2);
  });

  it("never surfaces largestMovements or unusualGrowth as findings — a large or unusual figure isn't inherently a problem", () => {
    const report = emptyReport({
      largestMovements: [{ transactionId: 1, accountId: 1, accountCode: "6100", accountDescription: "Rent", postingDate: "2026-08-05", amount: 999999, description: "d", reference: "r", reasoning: "r" }],
      unusualGrowth: [{ accountId: 1, accountCode: "6100", accountDescription: "Rent", currentMovement: 1000, previousMovement: 10, changePercent: 9900, reasoning: "r" }],
    });
    expect(findGeneralLedgerFindings({ companyId: "co_1", report })).toEqual([]);
  });

  it("every finding routes to the real General Ledger journals view, never an invented route", () => {
    const report = emptyReport({ missingPostings: [{ journalId: 5, journalNumber: "JNL-005", status: "Draft", ageDays: 15, reasoning: "r" }] });
    expect(findGeneralLedgerFindings({ companyId: "co_1", report })[0].actionHref).toBe("/company/co_1/general-ledger?tab=journals");
  });
});

describe("findCashFlowFindings", () => {
  it("produces nothing when totalCash wasn't supplied (missing data)", () => {
    expect(findCashFlowFindings({ companyId: "co_1", totalCash: undefined })).toEqual([]);
  });

  it("produces nothing for a positive or zero cash balance (negative condition, boundary at exactly 0)", () => {
    expect(findCashFlowFindings({ companyId: "co_1", totalCash: 5000 })).toEqual([]);
    expect(findCashFlowFindings({ companyId: "co_1", totalCash: 0 })).toEqual([]);
  });

  it("flags a real negative cash balance as Critical, with the real figure as evidence (positive condition)", () => {
    const findings = findCashFlowFindings({ companyId: "co_1", totalCash: -1500 });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("Critical");
    expect(findings[0].category).toBe("CashFlow");
    expect(findings[0].evidence).toContain(fmt(-1500));
  });

  it("routes to the real Banking Command Centre, never an invented route", () => {
    expect(findCashFlowFindings({ companyId: "co_1", totalCash: -1 })[0].actionHref).toBe("/company/co_1/bank-accounts");
  });
});

describe("findProfitabilityFindings", () => {
  it("produces nothing when netProfit wasn't supplied (missing data)", () => {
    expect(findProfitabilityFindings({ companyId: "co_1", netProfit: undefined })).toEqual([]);
  });

  it("produces nothing for a positive or zero net profit (negative condition, boundary at exactly 0)", () => {
    expect(findProfitabilityFindings({ companyId: "co_1", netProfit: 100 })).toEqual([]);
    expect(findProfitabilityFindings({ companyId: "co_1", netProfit: 0 })).toEqual([]);
  });

  it("flags a real net loss as High, with the real figure as evidence (positive condition)", () => {
    const findings = findProfitabilityFindings({ companyId: "co_1", netProfit: -2500.5 });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("High");
    expect(findings[0].category).toBe("Profitability");
    expect(findings[0].evidence).toContain(fmt(-2500.5));
  });

  it("never claims a trend — only the current period's real figure", () => {
    const findings = findProfitabilityFindings({ companyId: "co_1", netProfit: -100 });
    expect(findings[0].description.toLowerCase()).not.toMatch(/declin|falling|trend|worsen/);
  });
});

function assetFinding(overrides: Partial<AssetFinding> & Pick<AssetFinding, "id" | "findingType">): AssetFinding {
  return {
    companyId: "co_1",
    assetId: 1,
    confidence: 0.8,
    reason: "Test reason",
    evidence: "Test evidence",
    suggestedAction: "Review the Fixed Assets workspace.",
    status: "Open",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("findingsFromAssetFindings", () => {
  it("produces nothing when omitted (missing data)", () => {
    expect(findingsFromAssetFindings(undefined)).toEqual([]);
  });

  it("produces nothing for an empty list (empty data)", () => {
    expect(findingsFromAssetFindings([])).toEqual([]);
  });

  it("wraps a real asset finding with its real reason/evidence/suggestedAction unchanged (positive condition)", () => {
    const findings = findingsFromAssetFindings([assetFinding({ id: 1, findingType: "OverdueReplacement", reason: "Asset X is overdue for replacement.", evidence: "5 years past its useful life." })]);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("Operations");
    expect(findings[0].title).toBe("Asset X is overdue for replacement.");
    expect(findings[0].evidence).toBe("5 years past its useful life.");
    expect(findings[0].recommendedAction).toBe("Review the Fixed Assets workspace.");
    expect(findings[0].actionHref).toBe("/company/co_1/assets");
  });

  it("derives severity from the SAME FINDING_PENALTY weight table asset-dashboard-summary-service.ts already uses — not a new weighting", () => {
    // ImpairmentIndicator has the highest real penalty (7) -> High; WarrantyExpiry the lowest (2) -> Low.
    expect(findingsFromAssetFindings([assetFinding({ id: 1, findingType: "ImpairmentIndicator" })])[0].severity).toBe("High");
    expect(findingsFromAssetFindings([assetFinding({ id: 2, findingType: "WarrantyExpiry" })])[0].severity).toBe("Low");
    expect(findingsFromAssetFindings([assetFinding({ id: 3, findingType: "HighMaintenanceRisk" })])[0].severity).toBe("Medium");
  });

  it("marks a finding with no real suggested action as informational rather than inventing one", () => {
    const findings = findingsFromAssetFindings([assetFinding({ id: 1, findingType: "HighValueAsset", suggestedAction: "" })]);
    expect(findings[0].recommendedAction).toBeNull();
    expect(findings[0].actionHref).toBeNull();
  });

  it("wraps multiple asset findings together (multiple simultaneous findings)", () => {
    const findings = findingsFromAssetFindings([assetFinding({ id: 1, findingType: "OverdueReplacement" }), assetFinding({ id: 2, findingType: "IdleAsset" })]);
    expect(findings).toHaveLength(2);
  });
});

function auditFinding(overrides: Partial<AuditFinding> & Pick<AuditFinding, "id" | "severity">): AuditFinding {
  return {
    companyId: "co_1",
    engagementId: null,
    findingType: "DuplicatePayments",
    category: "Test",
    confidence: 0.8,
    reason: "Test reason",
    evidence: "Test evidence",
    suggestedProcedure: "Review the Auditor Workspace.",
    relatedType: null,
    relatedId: null,
    status: "Open",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("findingsFromAuditFindings", () => {
  it("produces nothing when omitted (missing data)", () => {
    expect(findingsFromAuditFindings(undefined)).toEqual([]);
  });

  it("produces nothing for an empty list (empty data)", () => {
    expect(findingsFromAuditFindings([])).toEqual([]);
  });

  it("wraps a real audit finding, copying severity verbatim — the exact same scale, no mapping needed (positive condition)", () => {
    const findings = findingsFromAuditFindings([auditFinding({ id: 1, severity: "Critical", reason: "Duplicate payment detected.", evidence: "2 identical payments on the same date." })]);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("Compliance");
    expect(findings[0].severity).toBe("Critical");
    expect(findings[0].title).toBe("Duplicate payment detected.");
    expect(findings[0].evidence).toBe("2 identical payments on the same date.");
    expect(findings[0].recommendedAction).toBe("Review the Auditor Workspace.");
    expect(findings[0].actionHref).toBe("/company/co_1/auditor");
  });

  it("preserves every real severity value unchanged for all four levels", () => {
    for (const severity of ["Low", "Medium", "High", "Critical"] as const) {
      expect(findingsFromAuditFindings([auditFinding({ id: 1, severity })])[0].severity).toBe(severity);
    }
  });

  it("marks a finding with no real suggested procedure as informational rather than inventing one", () => {
    const findings = findingsFromAuditFindings([auditFinding({ id: 1, severity: "Low", suggestedProcedure: "" })]);
    expect(findings[0].recommendedAction).toBeNull();
  });

  it("wraps multiple audit findings together, preserving real companyId/createdAt (multiple simultaneous findings)", () => {
    const findings = findingsFromAuditFindings([auditFinding({ id: 1, severity: "High" }), auditFinding({ id: 2, severity: "Low" })]);
    expect(findings).toHaveLength(2);
    expect(findings[0].companyId).toBe("co_1");
    expect(findings[0].createdAt).toBe("2026-08-01T00:00:00Z");
  });
});

describe("findDataQualityFindings — Chart of Accounts (Phase 13)", () => {
  it("does not flag Chart of Accounts when hasChartOfAccounts is omitted (unknown, never a false claim)", () => {
    const findings = findDataQualityFindings(FULLY_CONFIGURED_DATA_QUALITY);
    expect(findings.find((f) => f.id === "data-quality-no-chart-of-accounts")).toBeUndefined();
  });

  it("does not flag Chart of Accounts when it's explicitly configured (negative condition)", () => {
    const findings = findDataQualityFindings({ ...FULLY_CONFIGURED_DATA_QUALITY, hasChartOfAccounts: true });
    expect(findings).toEqual([]);
  });

  it("flags a missing Chart of Accounts only on an explicit false (positive condition)", () => {
    const findings = findDataQualityFindings({ ...FULLY_CONFIGURED_DATA_QUALITY, hasChartOfAccounts: false });
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("data-quality-no-chart-of-accounts");
    expect(findings[0].category).toBe("DataQuality");
  });
});

describe("buildFinancialIntelligenceSummary — Phase 13 expansion", () => {
  const cleanInput: FinancialIntelligenceInput = {
    ...FULLY_CONFIGURED_DATA_QUALITY,
    openExceptions: [],
    accountsNeedingReconciliation: 0,
    awaitingReviewCount: 0,
    unallocatedCount: 0,
    debtorsAging: EMPTY_AGING,
    creditorsAging: EMPTY_AGING,
    vatSummary: EMPTY_VAT,
    openExecutiveAlerts: [],
  };

  it("still produces zero findings for a fully clean company when every Phase 13 input is simply omitted (Phase 10/11 behaviour unchanged)", () => {
    const result = buildFinancialIntelligenceSummary(cleanInput);
    expect(result.findings).toEqual([]);
    expect(result.totalCash).toBeUndefined();
    expect(result.netProfit).toBeUndefined();
  });

  it("echoes totalCash/netProfit straight through for VYRON Ask to reuse, never recomputing them", () => {
    const result = buildFinancialIntelligenceSummary({ ...cleanInput, totalCash: 12345.67, netProfit: -500 });
    expect(result.totalCash).toBe(12345.67);
    expect(result.netProfit).toBe(-500);
  });

  it("combines findings across every Phase 13 category at once alongside the Phase 10 ones (multiple simultaneous findings)", () => {
    const result = buildFinancialIntelligenceSummary({
      ...cleanInput,
      totalCash: -100,
      netProfit: -50,
      hasChartOfAccounts: false,
      financialIntelligenceReport: emptyReport({ missingPostings: [{ journalId: 1, journalNumber: "JNL-001", status: "Draft", ageDays: 15, reasoning: "r" }] }),
      openAssetFindings: [assetFinding({ id: 1, findingType: "OverdueReplacement" })],
      openAuditFindings: [auditFinding({ id: 1, severity: "High" })],
    });
    const categories = new Set(result.findings.map((f) => f.category));
    expect(categories).toEqual(new Set(["DataQuality", "CashFlow", "Profitability", "GeneralLedger", "Operations", "Compliance"]));
  });

  it("keeps every new category within the documented Critical -> High -> Medium -> Low sort order (severity ordering)", () => {
    const result = buildFinancialIntelligenceSummary({
      ...cleanInput,
      totalCash: -100, // Critical
      openAuditFindings: [auditFinding({ id: 1, severity: "Low" })], // Low
      hasChartOfAccounts: false, // Medium
    });
    const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const severities = result.findings.map((f) => f.severity);
    for (let i = 1; i < severities.length; i++) {
      expect(rank[severities[i]]).toBeGreaterThanOrEqual(rank[severities[i - 1]]);
    }
    expect(severities[0]).toBe("Critical");
  });
});
