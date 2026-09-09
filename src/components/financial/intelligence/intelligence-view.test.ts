import { describe, expect, it } from "vitest";
import { ALL_CATEGORIES, categoryLabel, distinctCategories, distinctMetaGroups, filterFindings, metaGroup, splitDataQuality } from "./intelligence-view";
import type { Finding, FindingCategory } from "@/server/financial-intelligence/types";

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

describe("distinctCategories", () => {
  it("returns an empty list for no findings", () => {
    expect(distinctCategories([])).toEqual([]);
  });

  it("returns categories in first-seen order, never duplicated", () => {
    const findings = [
      finding({ id: "1", category: "Banking", severity: "High" }),
      finding({ id: "2", category: "VAT", severity: "Medium" }),
      finding({ id: "3", category: "Banking", severity: "Medium" }),
    ];
    expect(distinctCategories(findings)).toEqual(["Banking", "VAT"]);
  });

  it("never invents a category the engine didn't return", () => {
    const findings = [finding({ id: "1", category: "Customers", severity: "High" })];
    expect(distinctCategories(findings)).toEqual(["Customers"]);
  });
});

describe("filterFindings", () => {
  const findings = [
    finding({ id: "1", category: "Banking", severity: "High" }),
    finding({ id: "2", category: "VAT", severity: "Medium" }),
    finding({ id: "3", category: "Banking", severity: "Low" }),
  ];

  it("returns every finding when the filter is All", () => {
    expect(filterFindings(findings, ALL_CATEGORIES)).toEqual(findings);
  });

  it("returns only findings matching the selected category", () => {
    expect(filterFindings(findings, "Banking").map((f) => f.id)).toEqual(["1", "3"]);
  });

  it("returns an empty list for a category with zero matches", () => {
    expect(filterFindings(findings, "Suppliers")).toEqual([]);
  });
});

describe("splitDataQuality", () => {
  it("separates Data Quality findings from every other category", () => {
    const findings = [
      finding({ id: "1", category: "DataQuality", severity: "Medium" }),
      finding({ id: "2", category: "Banking", severity: "High" }),
      finding({ id: "3", category: "DataQuality", severity: "Medium" }),
    ];
    const { dataQuality, other } = splitDataQuality(findings);
    expect(dataQuality.map((f) => f.id)).toEqual(["1", "3"]);
    expect(other.map((f) => f.id)).toEqual(["2"]);
  });

  it("returns two empty lists for no findings", () => {
    expect(splitDataQuality([])).toEqual({ dataQuality: [], other: [] });
  });

  it("puts everything in other when there are no Data Quality findings", () => {
    const findings = [finding({ id: "1", category: "VAT", severity: "Critical" })];
    expect(splitDataQuality(findings)).toEqual({ dataQuality: [], other: findings });
  });
});

describe("categoryLabel", () => {
  it("returns the real human-readable label for every category the engine can return", () => {
    expect(categoryLabel("DataQuality")).toBe("Data Quality");
    expect(categoryLabel("CashFlow")).toBe("Cash Flow");
    expect(categoryLabel("VAT")).toBe("VAT");
    expect(categoryLabel("GeneralLedger")).toBe("General Ledger");
  });
});

describe("metaGroup (Phase 13, section 14)", () => {
  it("classifies every real category into exactly one of Financial Risk / Operational Attention / Data Quality", () => {
    const allCategories: FindingCategory[] = ["CashFlow", "Banking", "Transactions", "Customers", "Suppliers", "VAT", "Profitability", "Compliance", "Operations", "DataQuality", "GeneralLedger"];
    for (const category of allCategories) {
      expect(["Financial Risk", "Operational Attention", "Data Quality"]).toContain(metaGroup(category));
    }
  });

  it("classifies Data Quality as its own group, never Financial Risk or Operational Attention", () => {
    expect(metaGroup("DataQuality")).toBe("Data Quality");
  });

  it("classifies Banking/Transactions/Operations as Operational Attention", () => {
    expect(metaGroup("Banking")).toBe("Operational Attention");
    expect(metaGroup("Transactions")).toBe("Operational Attention");
    expect(metaGroup("Operations")).toBe("Operational Attention");
  });

  it("classifies the real financial-figure categories as Financial Risk", () => {
    expect(metaGroup("CashFlow")).toBe("Financial Risk");
    expect(metaGroup("Profitability")).toBe("Financial Risk");
    expect(metaGroup("GeneralLedger")).toBe("Financial Risk");
    expect(metaGroup("VAT")).toBe("Financial Risk");
    expect(metaGroup("Customers")).toBe("Financial Risk");
    expect(metaGroup("Suppliers")).toBe("Financial Risk");
    expect(metaGroup("Compliance")).toBe("Financial Risk");
  });
});

describe("distinctMetaGroups", () => {
  it("returns an empty list for no findings (empty data)", () => {
    expect(distinctMetaGroups([])).toEqual([]);
  });

  it("returns only the groups actually present, never inventing one with zero findings", () => {
    const findings = [finding({ id: "1", category: "Banking", severity: "High" })];
    expect(distinctMetaGroups(findings)).toEqual(["Operational Attention"]);
  });

  it("returns multiple groups together in the fixed Financial Risk -> Operational Attention -> Data Quality order", () => {
    const findings = [
      finding({ id: "1", category: "DataQuality", severity: "Medium" }),
      finding({ id: "2", category: "Banking", severity: "High" }),
      finding({ id: "3", category: "VAT", severity: "Critical" }),
    ];
    expect(distinctMetaGroups(findings)).toEqual(["Financial Risk", "Operational Attention", "Data Quality"]);
  });
});
