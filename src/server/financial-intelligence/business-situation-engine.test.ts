import { describe, expect, it } from "vitest";
import { buildBusinessSituations, dedupeRecommendedActions, maxSeverity } from "./business-situation-engine";
import type { Finding } from "./types";

function finding(overrides: Partial<Finding> & Pick<Finding, "id" | "category" | "severity">): Finding {
  return {
    title: "Test finding",
    description: "Test description",
    evidence: "Test evidence",
    recommendedAction: "Test action",
    actionHref: "/company/co_1/dashboard",
    source: "Deterministic",
    ...overrides,
  };
}

const NEGATIVE_CASH = finding({ id: "cashflow-negative-balance", category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." });
const CUSTOMERS_OVERDUE = finding({ id: "customers-overdue-balance", category: "Customers", severity: "High", title: "Customer balance overdue", evidence: "R 15,000.00 overdue by more than 90 days.", recommendedAction: "Review Customer Aging", actionHref: "/company/co_1/customers" });
const SUPPLIERS_OVERDUE = finding({ id: "suppliers-overdue-balance", category: "Suppliers", severity: "High", title: "Supplier balance overdue", evidence: "R 8,000.00 overdue by more than 90 days.", recommendedAction: "Review Supplier Aging", actionHref: "/company/co_1/suppliers" });
const NET_LOSS = finding({ id: "profitability-net-loss", category: "Profitability", severity: "High", title: "Net loss this period", evidence: "Net Profit: R -2,000.00.", recommendedAction: "Review Financial Reports", actionHref: "/company/co_1/reports" });
const POSSIBLE_DUPLICATE = finding({ id: "banking-exception-PossibleDuplicate", category: "Banking", severity: "High", title: "2 possible duplicates detected", evidence: "2 open PossibleDuplicate exception(s).", recommendedAction: "Review Banking Exceptions", actionHref: "/company/co_1/banking-exceptions" });
const LARGE_UNUSUAL = finding({ id: "banking-exception-LargeUnusualPayment", category: "Banking", severity: "High", title: "1 large unusual payment detected", evidence: "1 open LargeUnusualPayment exception(s).", recommendedAction: "Review Banking Exceptions", actionHref: "/company/co_1/banking-exceptions" });
const UNRELATED_VAT = finding({ id: "vat-liability-exists", category: "VAT", severity: "Medium", title: "VAT liability exists" });
const DATA_QUALITY_NO_CUSTOMERS = finding({ id: "data-quality-no-customers", category: "DataQuality", severity: "Medium", title: "No customers have been added yet" });

describe("buildBusinessSituations", () => {
  it("produces no situations for an empty Finding[] (no situations)", () => {
    expect(buildBusinessSituations([])).toEqual([]);
  });

  it("produces no situations when findings are unrelated — no shared rule connects them (unrelated findings)", () => {
    const result = buildBusinessSituations([UNRELATED_VAT, DATA_QUALITY_NO_CUSTOMERS]);
    expect(result).toEqual([]);
  });

  it("produces no situations when only ONE half of a two-finding relationship is present (missing data)", () => {
    expect(buildBusinessSituations([NEGATIVE_CASH])).toEqual([]);
    expect(buildBusinessSituations([CUSTOMERS_OVERDUE])).toEqual([]);
  });

  it("never fires a rule on a near-miss — same category, different specific finding (no false correlations)", () => {
    // VAT liability + a Banking finding that ISN'T one of the two specific
    // exception types the Elevated Payment Review Activity rule requires.
    const unrelatedBanking = finding({ id: "banking-reconciliation-outstanding", category: "Banking", severity: "Medium", title: "Bank reconciliation outstanding" });
    expect(buildBusinessSituations([UNRELATED_VAT, unrelatedBanking])).toEqual([]);
  });

  it("detects Cash Collection Pressure only when BOTH real findings are present (one valid situation, related findings)", () => {
    const result = buildBusinessSituations([NEGATIVE_CASH, CUSTOMERS_OVERDUE]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("situation-cash-collection-pressure");
    expect(result[0].title).toBe("Cash Collection Pressure");
    expect(result[0].category).toBe("WorkingCapital");
  });

  it("detects Elevated Payment Review Activity only when both real banking findings are present", () => {
    const result = buildBusinessSituations([POSSIBLE_DUPLICATE, LARGE_UNUSUAL]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("situation-elevated-payment-review-activity");
    expect(result[0].category).toBe("TransactionRisk");
  });

  it("detects Current Financial Pressure only when both real findings are present", () => {
    const result = buildBusinessSituations([NET_LOSS, NEGATIVE_CASH]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("situation-current-financial-pressure");
    expect(result[0].category).toBe("CashPressure");
  });

  it("detects Working Capital Pressure only when both real aging findings are present", () => {
    const result = buildBusinessSituations([CUSTOMERS_OVERDUE, SUPPLIERS_OVERDUE]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("situation-working-capital-pressure");
  });

  it("never lets a Data Quality finding participate in any relationship, even alongside real matching findings", () => {
    const result = buildBusinessSituations([NEGATIVE_CASH, CUSTOMERS_OVERDUE, DATA_QUALITY_NO_CUSTOMERS]);
    expect(result).toHaveLength(1);
    expect(result.every((s) => s.contributingFindings.every((f) => f.category !== "DataQuality"))).toBe(true);
  });

  it("detects multiple simultaneous situations at once when their findings all co-occur (multiple situations)", () => {
    const result = buildBusinessSituations([NEGATIVE_CASH, CUSTOMERS_OVERDUE, SUPPLIERS_OVERDUE, POSSIBLE_DUPLICATE, LARGE_UNUSUAL, NET_LOSS]);
    expect(result.map((s) => s.id).sort()).toEqual(
      ["situation-cash-collection-pressure", "situation-current-financial-pressure", "situation-elevated-payment-review-activity", "situation-working-capital-pressure"].sort(),
    );
  });

  it("never merges or removes the underlying findings — they remain independently intact on the situation", () => {
    const result = buildBusinessSituations([NEGATIVE_CASH, CUSTOMERS_OVERDUE]);
    expect(result[0].contributingFindings).toEqual([NEGATIVE_CASH, CUSTOMERS_OVERDUE]);
  });

  it("exposes the real evidence chain: situation -> contributing findings -> real evidence strings (evidence chains)", () => {
    const result = buildBusinessSituations([NEGATIVE_CASH, CUSTOMERS_OVERDUE]);
    expect(result[0].evidence).toEqual(["Total cash: R -500.00.", "R 15,000.00 overdue by more than 90 days."]);
  });

  it("uses only honest, non-causal language — never claims one condition caused another", () => {
    const result = buildBusinessSituations([NEGATIVE_CASH, CUSTOMERS_OVERDUE]);
    expect(result[0].summary).toMatch(/^VYRON identified/);
    expect(result[0].summary.toLowerCase()).not.toMatch(/caus|result in|lead(ing)? to|because of/);
  });

  it("orders situations most-severe-first, matching the documented severity ordering (situation ordering)", () => {
    // Cash Collection Pressure: Critical (from NEGATIVE_CASH). Working Capital Pressure: High (both High).
    const result = buildBusinessSituations([NEGATIVE_CASH, CUSTOMERS_OVERDUE, SUPPLIERS_OVERDUE]);
    expect(result[0].severity).toBe("Critical");
    const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    for (let i = 1; i < result.length; i++) {
      expect(rank[result[i].severity]).toBeGreaterThanOrEqual(rank[result[i - 1].severity]);
    }
  });

  it("Phase 10-13 regression: Finding[] itself is never altered by being passed through this engine", () => {
    const input = [NEGATIVE_CASH, CUSTOMERS_OVERDUE, UNRELATED_VAT];
    const before = JSON.stringify(input);
    buildBusinessSituations(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("maxSeverity (severity handling)", () => {
  it("returns Low for an empty list", () => {
    expect(maxSeverity([])).toBe("Low");
  });

  it("returns the single finding's own severity", () => {
    expect(maxSeverity([{ severity: "Medium" }])).toBe("Medium");
  });

  it("never escalates two Medium findings into Critical — returns the real worst present, Medium (brief's own explicit example)", () => {
    expect(maxSeverity([{ severity: "Medium" }, { severity: "Medium" }])).toBe("Medium");
  });

  it("returns the real most severe value among mixed severities, regardless of order", () => {
    expect(maxSeverity([{ severity: "Low" }, { severity: "Critical" }, { severity: "Medium" }])).toBe("Critical");
    expect(maxSeverity([{ severity: "High" }, { severity: "Low" }])).toBe("High");
  });
});

describe("dedupeRecommendedActions (duplicate actions)", () => {
  it("returns an empty list when no contributing finding has a real action", () => {
    expect(dedupeRecommendedActions([{ recommendedAction: null, actionHref: null }])).toEqual([]);
  });

  it("returns one entry per distinct real href, in finding order", () => {
    const actions = dedupeRecommendedActions([
      { recommendedAction: "Review Customer Aging", actionHref: "/company/co_1/customers" },
      { recommendedAction: "Review Supplier Aging", actionHref: "/company/co_1/suppliers" },
    ]);
    expect(actions).toEqual([
      { label: "Review Customer Aging", href: "/company/co_1/customers" },
      { label: "Review Supplier Aging", href: "/company/co_1/suppliers" },
    ]);
  });

  it("deduplicates two findings that share the exact same real action/route (duplicate actions)", () => {
    const actions = dedupeRecommendedActions([
      { recommendedAction: "Review Banking Exceptions", actionHref: "/company/co_1/banking-exceptions" },
      { recommendedAction: "Review Banking Exceptions", actionHref: "/company/co_1/banking-exceptions" },
    ]);
    expect(actions).toEqual([{ label: "Review Banking Exceptions", href: "/company/co_1/banking-exceptions" }]);
  });

  it("skips a finding with no real action rather than inventing one", () => {
    const actions = dedupeRecommendedActions([
      { recommendedAction: null, actionHref: null },
      { recommendedAction: "Review Customer Aging", actionHref: "/company/co_1/customers" },
    ]);
    expect(actions).toEqual([{ label: "Review Customer Aging", href: "/company/co_1/customers" }]);
  });
});

describe("Cash Collection Pressure and Working Capital Pressure — recommended action deduplication end to end", () => {
  it("deduplicates the real recommended actions across the situation's contributing findings", () => {
    const result = buildBusinessSituations([CUSTOMERS_OVERDUE, SUPPLIERS_OVERDUE]);
    expect(result[0].recommendedActions).toEqual([
      { label: "Review Customer Aging", href: "/company/co_1/customers" },
      { label: "Review Supplier Aging", href: "/company/co_1/suppliers" },
    ]);
  });

  it("deduplicates when both contributing findings share the exact same real action (Elevated Payment Review Activity)", () => {
    const result = buildBusinessSituations([POSSIBLE_DUPLICATE, LARGE_UNUSUAL]);
    expect(result[0].recommendedActions).toEqual([{ label: "Review Banking Exceptions", href: "/company/co_1/banking-exceptions" }]);
  });
});
