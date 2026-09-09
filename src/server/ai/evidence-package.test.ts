import { describe, expect, it } from "vitest";
import { buildEvidencePackage, intelligenceCentreHref } from "./evidence-package";
import type { BusinessSituation, Finding } from "@/server/financial-intelligence/types";

function finding(overrides: Partial<Finding> & Pick<Finding, "id" | "category" | "severity" | "title">): Finding {
  return {
    description: "Test description",
    evidence: "Test evidence",
    recommendedAction: "Test action",
    actionHref: "/company/co_1/dashboard",
    source: "Deterministic",
    companyId: "co_1",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function situation(overrides: Partial<BusinessSituation> & Pick<BusinessSituation, "id" | "title" | "contributingFindings">): BusinessSituation {
  return {
    summary: "VYRON identified two related conditions.",
    severity: "High",
    category: "WorkingCapital",
    evidence: overrides.contributingFindings.map((f) => f.evidence),
    recommendedActions: [],
    ...overrides,
  };
}

describe("buildEvidencePackage", () => {
  it("carries the company, question, and as-of date through unchanged", () => {
    const pkg = buildEvidencePackage({ id: "co_1", name: "Acme Ltd" }, "What's worrying you most?", "2026-08-12", { findings: [], totalCash: undefined, netProfit: undefined }, []);
    expect(pkg.companyId).toBe("co_1");
    expect(pkg.companyName).toBe("Acme Ltd");
    expect(pkg.question).toBe("What's worrying you most?");
    expect(pkg.asOfDate).toBe("2026-08-12");
  });

  it("always includes a real, working Intelligence Centre route", () => {
    const pkg = buildEvidencePackage({ id: "co_42", name: "Acme Ltd" }, "q", "2026-08-12", { findings: [], totalCash: undefined, netProfit: undefined }, []);
    expect(pkg.intelligenceCentreHref).toBe("/company/co_42/intelligence");
    expect(intelligenceCentreHref("co_42")).toBe(pkg.intelligenceCentreHref);
  });

  it("maps every real finding into the strict evidence allow-list (Finding context)", () => {
    const f = finding({ id: "cashflow-negative-balance", category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." });
    const pkg = buildEvidencePackage({ id: "co_1", name: "Acme" }, "q", "2026-08-12", { findings: [f], totalCash: -500, netProfit: undefined }, []);
    expect(pkg.findings).toEqual([
      {
        id: "cashflow-negative-balance",
        category: "CashFlow",
        severity: "Critical",
        title: "Cash balance is negative",
        description: "Test description",
        evidence: "Total cash: R -500.00.",
        recommendedAction: "Test action",
        actionHref: "/company/co_1/dashboard",
      },
    ]);
  });

  it("never includes a Finding's companyId/createdAt in the evidence sent to the provider (evidence isolation)", () => {
    const f = finding({ id: "a", category: "Banking", severity: "High", title: "A", companyId: "co_1", createdAt: "2026-08-01T00:00:00.000Z" });
    const pkg = buildEvidencePackage({ id: "co_1", name: "Acme" }, "q", "2026-08-12", { findings: [f], totalCash: undefined, netProfit: undefined }, []);
    expect(pkg.findings[0]).not.toHaveProperty("companyId");
    expect(pkg.findings[0]).not.toHaveProperty("createdAt");
    expect(pkg.findings[0]).not.toHaveProperty("source");
  });

  it("maps every real business situation, referencing contributing findings by id only, not the full nested objects (BusinessSituation context)", () => {
    const a = finding({ id: "cashflow-negative-balance", category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." });
    const b = finding({ id: "customers-overdue-balance", category: "Customers", severity: "High", title: "Customer balance overdue", evidence: "R 15,000.00 overdue." });
    const s = situation({
      id: "situation-cash-collection-pressure",
      title: "Cash Collection Pressure",
      severity: "Critical",
      category: "WorkingCapital",
      contributingFindings: [a, b],
      recommendedActions: [{ label: "Review Customer Aging", href: "/company/co_1/customers" }],
    });
    const pkg = buildEvidencePackage({ id: "co_1", name: "Acme" }, "q", "2026-08-12", { findings: [a, b], totalCash: -500, netProfit: undefined }, [s]);
    expect(pkg.situations).toEqual([
      {
        id: "situation-cash-collection-pressure",
        title: "Cash Collection Pressure",
        summary: "VYRON identified two related conditions.",
        severity: "Critical",
        category: "WorkingCapital",
        evidence: ["Total cash: R -500.00.", "R 15,000.00 overdue."],
        contributingFindingIds: ["cashflow-negative-balance", "customers-overdue-balance"],
        recommendedActions: [{ label: "Review Customer Aging", href: "/company/co_1/customers" }],
      },
    ]);
  });

  it("uses null, not a fabricated zero, when a real summary figure isn't available", () => {
    const pkg = buildEvidencePackage({ id: "co_1", name: "Acme" }, "q", "2026-08-12", { findings: [], totalCash: undefined, netProfit: undefined }, []);
    expect(pkg.totalCash).toBeNull();
    expect(pkg.netProfit).toBeNull();
  });

  it("carries real totalCash/netProfit figures through when they exist, including zero and negative values", () => {
    const pkg = buildEvidencePackage({ id: "co_1", name: "Acme" }, "q", "2026-08-12", { findings: [], totalCash: 0, netProfit: -300 }, []);
    expect(pkg.totalCash).toBe(0);
    expect(pkg.netProfit).toBe(-300);
  });

  it("produces an empty evidence package for a company with no findings or situations (empty data)", () => {
    const pkg = buildEvidencePackage({ id: "co_1", name: "Acme" }, "q", "2026-08-12", { findings: [], totalCash: undefined, netProfit: undefined }, []);
    expect(pkg.findings).toEqual([]);
    expect(pkg.situations).toEqual([]);
  });
});
