/**
 * Phase 51, Fix 4 — the Banking Rules screen grew to 100+ active rules
 * (see the Phase 50 forensic report) with only a domain dropdown to
 * narrow it. `ruleMatchesSearch` is the pure matching logic (name,
 * description, any condition's value, any action's target); these tests
 * exercise it directly AND through the real rendered search input, so
 * the exact on-screen behaviour is proven, not just the pure function.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/test",
  useSearchParams: () => new URLSearchParams(),
}));

import { BankingRulesTab, ruleMatchesSearch } from "./banking-rules-tab";
import type { BankingRule } from "@/server/banking-rules/types";

function rule(overrides: Partial<BankingRule> & Pick<BankingRule, "id" | "name">): BankingRule {
  return {
    companyId: "co_1", domain: "Banking", ruleType: "GL", description: "", priority: 100, isActive: true, version: 1,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", createdBy: "tester", updatedBy: "tester",
    conditions: [{ id: 1, field: "description", operator: "contains", value: "salary", value2: null }],
    actions: [{ id: 1, actionType: "set_gl_account", targetId: null, targetText: "6940" }],
    ...overrides,
  };
}

describe("ruleMatchesSearch (Phase 51, Fix 4)", () => {
  const target = rule({
    id: 1,
    name: "Auto: Salary → GL",
    description: "Created inline while allocating a transaction.",
    conditions: [{ id: 1, field: "description", operator: "contains", value: "Lucretia Salary", value2: null }],
    actions: [{ id: 1, actionType: "set_gl_account", targetId: null, targetText: "6940" }],
  });

  it("matches by rule name, case-insensitively", () => {
    expect(ruleMatchesSearch(target, "salary")).toBe(true);
    expect(ruleMatchesSearch(target, "SALARY")).toBe(true);
    expect(ruleMatchesSearch(target, "→ gl")).toBe(true);
  });

  it("matches by description", () => {
    expect(ruleMatchesSearch(target, "allocating a transaction")).toBe(true);
  });

  it("matches by condition value (the actual text a rule was built from)", () => {
    expect(ruleMatchesSearch(target, "lucretia")).toBe(true);
  });

  it("matches by action target text (e.g. a GL account code)", () => {
    expect(ruleMatchesSearch(target, "6940")).toBe(true);
  });

  it("matches by action target id (a supplier/customer/merchant id-based action)", () => {
    const supplierRule = rule({ id: 2, name: "Auto: Fish → Supplier", actions: [{ id: 2, actionType: "set_supplier", targetId: 636, targetText: null }] });
    expect(ruleMatchesSearch(supplierRule, "636")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(ruleMatchesSearch(target, "petrol")).toBe(false);
  });

  it("an empty/blank query matches everything", () => {
    expect(ruleMatchesSearch(target, "")).toBe(true);
    expect(ruleMatchesSearch(target, "   ")).toBe(true);
  });
});

describe("BankingRulesTab — search box (Phase 51, Fix 4)", () => {
  const rules: BankingRule[] = [
    rule({ id: 1, name: "Auto: Salary → GL", conditions: [{ id: 1, field: "description", operator: "contains", value: "Lucretia Salary", value2: null }] }),
    rule({ id: 2, name: "Auto: Fish → Supplier", domain: "Banking", ruleType: "Supplier", conditions: [{ id: 2, field: "description", operator: "contains", value: "Fish", value2: null }], actions: [{ id: 2, actionType: "set_supplier", targetId: 636, targetText: null }] }),
    rule({ id: 3, name: "Auto: Bank Charge → GL", isActive: false, conditions: [{ id: 3, field: "description", operator: "contains", value: "Bank Charge", value2: null }], actions: [{ id: 3, actionType: "set_gl_account", targetId: null, targetText: "6100" }] }),
  ];

  it("finds a rule by its exact name", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "Salary" } });
    expect(screen.getByDisplayValue("Auto: Salary → GL")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Auto: Fish → Supplier")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Auto: Bank Charge → GL")).not.toBeInTheDocument();
  });

  it("finds a rule by its condition text, not just its name", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "Fish" } });
    expect(screen.getByDisplayValue("Auto: Fish → Supplier")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Auto: Salary → GL")).not.toBeInTheDocument();
  });

  it("finds a rule by its action target (a GL account code)", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "6100" } });
    expect(screen.getByDisplayValue("Auto: Bank Charge → GL")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Auto: Salary → GL")).not.toBeInTheDocument();
  });

  it("shows a 'no matches' state, distinct from 'no rules at all', when the search finds nothing", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "no such rule exists" } });
    expect(screen.getByText("No rules match your search/filters.")).toBeInTheDocument();
  });

  it("the Active/Inactive status filter narrows the list independently of search", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "Inactive" } });
    expect(screen.getByDisplayValue("Auto: Bank Charge → GL")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Auto: Salary → GL")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Auto: Fish → Supplier")).not.toBeInTheDocument();
  });

  it("clearing the search restores every rule matching the remaining filters", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    const search = screen.getByLabelText("Search rules");
    fireEvent.change(search, { target: { value: "Salary" } });
    expect(screen.queryByDisplayValue("Auto: Fish → Supplier")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByDisplayValue("Auto: Salary → GL")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Auto: Fish → Supplier")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Auto: Bank Charge → GL")).toBeInTheDocument();
  });
});
