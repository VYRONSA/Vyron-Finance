/**
 * Phase 51, Fix 4 — the Banking Rules screen grew to 100+ active rules
 * (see the Phase 50 forensic report) with only a domain dropdown to
 * narrow it. `ruleMatchesSearch` is the pure matching logic (name,
 * description, any condition's value, any action's target); these tests
 * exercise it directly AND through the real rendered search input, so
 * the exact on-screen behaviour is proven, not just the pure function.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/test",
  useSearchParams: () => new URLSearchParams(),
}));

import { BankingRulesTab, ruleGlAccount, ruleMatchesSearch, ruleVatCode, summariseActions, summariseConditions } from "./banking-rules-tab";
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

// Phase 5G — rules now render as ROWS in one scrollable list rather
// than as a stream of permanently-open editor cards, so a rule is
// located by its visible name text. `getByDisplayValue` only worked
// because every rule used to mount an editable <Input> for its name.
describe("BankingRulesTab — search box (Phase 51, Fix 4)", () => {
  const rules: BankingRule[] = [
    rule({ id: 1, name: "Auto: Salary → GL", conditions: [{ id: 1, field: "description", operator: "contains", value: "Lucretia Salary", value2: null }] }),
    rule({ id: 2, name: "Auto: Fish → Supplier", domain: "Banking", ruleType: "Supplier", conditions: [{ id: 2, field: "description", operator: "contains", value: "Fish", value2: null }], actions: [{ id: 2, actionType: "set_supplier", targetId: 636, targetText: null }] }),
    rule({ id: 3, name: "Auto: Bank Charge → GL", isActive: false, conditions: [{ id: 3, field: "description", operator: "contains", value: "Bank Charge", value2: null }], actions: [{ id: 3, actionType: "set_gl_account", targetId: null, targetText: "6100" }] }),
  ];

  it("finds a rule by its exact name", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "Salary" } });
    expect(screen.getByText("Auto: Salary → GL")).toBeInTheDocument();
    expect(screen.queryByText("Auto: Fish → Supplier")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto: Bank Charge → GL")).not.toBeInTheDocument();
  });

  it("finds a rule by its condition text, not just its name", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "Fish" } });
    expect(screen.getByText("Auto: Fish → Supplier")).toBeInTheDocument();
    expect(screen.queryByText("Auto: Salary → GL")).not.toBeInTheDocument();
  });

  it("finds a rule by its action target (a GL account code)", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "6100" } });
    expect(screen.getByText("Auto: Bank Charge → GL")).toBeInTheDocument();
    expect(screen.queryByText("Auto: Salary → GL")).not.toBeInTheDocument();
  });

  it("shows a 'no matches' state, distinct from 'no rules at all', when the search finds nothing", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "no such rule exists" } });
    expect(screen.getByText("No rules match your search/filters.")).toBeInTheDocument();
  });

  it("the Active/Inactive status filter narrows the list independently of search", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "Inactive" } });
    expect(screen.getByText("Auto: Bank Charge → GL")).toBeInTheDocument();
    expect(screen.queryByText("Auto: Salary → GL")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto: Fish → Supplier")).not.toBeInTheDocument();
  });

  it("clearing the search restores every rule matching the remaining filters", () => {
    render(<BankingRulesTab companyId="co_1" rules={rules} previewMode />);
    const search = screen.getByLabelText("Search rules");
    fireEvent.change(search, { target: { value: "Salary" } });
    expect(screen.queryByText("Auto: Fish → Supplier")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByText("Auto: Salary → GL")).toBeInTheDocument();
    expect(screen.getByText("Auto: Fish → Supplier")).toBeInTheDocument();
    expect(screen.getByText("Auto: Bank Charge → GL")).toBeInTheDocument();
  });
});

describe("BankingRulesTab — Run Rule Engine Now (0100 review L4)", () => {
  function mockRun(outcome: Record<string, unknown>) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ outcome }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("says when a run stopped early and how many transactions are left", async () => {
    mockRun({ processed: 40, autoPosted: 38, exceptionsRaised: 2, stoppedEarly: true, remaining: 150 });
    render(<BankingRulesTab companyId="co_1" rules={[]} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Run Rule Engine Now" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("150 transaction(s) are left for the next run"));
    expect(screen.getByRole("status")).toHaveTextContent("Processed 40 transaction(s) — 38 automatically posted, 2 exception(s) raised.");
    vi.unstubAllGlobals();
  });

  it("says nothing about a next run when the run finished", async () => {
    mockRun({ processed: 3, autoPosted: 1, exceptionsRaised: 0, stoppedEarly: false, remaining: 0 });
    render(<BankingRulesTab companyId="co_1" rules={[]} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Run Rule Engine Now" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Processed 3 transaction(s)"));
    expect(screen.getByRole("status")).not.toHaveTextContent("next run");
    vi.unstubAllGlobals();
  });
});

// -----------------------------------------------------------------------
// Phase 5G — every rule in one scrollable list, and the existing editor
// opened from it.
//
// Before this, each rule mounted a complete inline editor, so 100+ rules
// meant 100+ open forms: you could not see what rules existed, scan for
// one, or reach it without scrolling past everything above it.
// -----------------------------------------------------------------------

describe("BankingRulesTab — the rule list (Phase 5G)", () => {
  const listRules: BankingRule[] = [
    rule({
      id: 1,
      name: "Auto: Salary → GL",
      priority: 10,
      ruleType: "GL",
      conditions: [{ id: 1, field: "description", operator: "contains", value: "Lucretia Salary", value2: null }],
      actions: [
        { id: 1, actionType: "set_gl_account", targetId: null, targetText: "6940" },
        { id: 2, actionType: "set_vat_code", targetId: null, targetText: "No VAT" },
      ],
    }),
    rule({
      id: 2,
      name: "Auto: Fish → Supplier",
      priority: 20,
      ruleType: "Supplier",
      isActive: false,
      conditions: [
        { id: 2, field: "beneficiary", operator: "equals", value: "Fish Co", value2: null },
        { id: 3, field: "amount", operator: "greater_than", value: "100", value2: null },
      ],
      actions: [{ id: 3, actionType: "set_supplier", targetId: 636, targetText: null }],
    }),
  ];

  it("lists EVERY rule as a row, with the columns needed to identify one", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);

    for (const r of listRules) expect(screen.getByText(r.name)).toBeInTheDocument();
    // Status, priority, type, condition, GL account and VAT are on screen.
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("6940")).toBeInTheDocument();
    expect(screen.getByText("No VAT")).toBeInTheDocument();
    expect(screen.getByText(/description contains Lucretia Salary/)).toBeInTheDocument();
  });

  it("says how many rules there are, and how many the filters left", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);
    expect(screen.getByText("2 rules")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "Salary" } });
    expect(screen.getByText("1 of 2 rules")).toBeInTheDocument();
  });

  it("does NOT open every rule's editor — that was the problem being fixed", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
  });

  it("selecting a rule opens THE existing editor for it, in place", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);

    fireEvent.click(screen.getByRole("button", { name: /Auto: Salary → GL/ }));

    // The existing RuleCard: its editable name input, and its own controls.
    expect(screen.getByDisplayValue("Auto: Salary → GL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("opening a second rule closes the first — one editor at a time", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);

    fireEvent.click(screen.getByRole("button", { name: /Auto: Salary → GL/ }));
    expect(screen.getByDisplayValue("Auto: Salary → GL")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Auto: Fish → Supplier/ }));

    expect(screen.queryByDisplayValue("Auto: Salary → GL")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Auto: Fish → Supplier")).toBeInTheDocument();
  });

  it("clicking the open rule again closes its editor", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);
    const row = screen.getByRole("button", { name: /Auto: Salary → GL/ });

    fireEvent.click(row);
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Auto: Salary → GL/ }));
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
  });

  it("the row control is a real button, so the list is keyboard operable", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);
    const row = screen.getByRole("button", { name: /Auto: Salary → GL/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    row.focus();
    expect(row).toHaveFocus();
  });

  it("preview mode still disables saving in the opened editor (permission gating unchanged)", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);
    fireEvent.click(screen.getByRole("button", { name: /Auto: Salary → GL/ }));
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("a rule can still be multi-selected from its row", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);
    fireEvent.click(screen.getByLabelText("Select rule Auto: Salary → GL"));
    expect(screen.getByLabelText("Select rule Auto: Salary → GL")).toBeChecked();
  });

  it("searching then opening still reaches the right rule", () => {
    render(<BankingRulesTab companyId="co_1" rules={listRules} previewMode />);
    fireEvent.change(screen.getByLabelText("Search rules"), { target: { value: "Fish" } });
    fireEvent.click(screen.getByRole("button", { name: /Auto: Fish → Supplier/ }));
    expect(screen.getByDisplayValue("Auto: Fish → Supplier")).toBeInTheDocument();
  });
});

describe("Phase 5G — search covers what the list shows", () => {
  const r = rule({
    id: 1,
    name: "Salary rule",
    description: "monthly payroll",
    ruleType: "GL",
    priority: 42,
    isActive: false,
    conditions: [{ id: 1, field: "gl_account", operator: "starts_with", value: "69", value2: null }],
    actions: [
      { id: 1, actionType: "set_gl_account", targetId: null, targetText: "6940" },
      { id: 2, actionType: "set_vat_code", targetId: null, targetText: "Zero Rated" },
    ],
  });

  it.each([
    ["rule name", "salary"],
    ["description", "payroll"],
    ["rule type", "gl"],
    ["GL account", "6940"],
    ["VAT treatment", "zero rated"],
    ["condition field", "gl account"],
    ["condition operator", "starts with"],
    ["action type", "set gl account"],
    ["priority", "42"],
    ["status word", "disabled"],
  ])("matches by %s", (_label, query) => {
    expect(ruleMatchesSearch(r, query)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(ruleMatchesSearch(r, "SALARY")).toBe(true);
    expect(ruleMatchesSearch(r, "sAlArY")).toBe(true);
  });

  it("does not match an unrelated term", () => {
    expect(ruleMatchesSearch(r, "zzz-not-present")).toBe(false);
  });

  it("an active rule matches the active words, not the disabled ones", () => {
    const active = rule({ id: 2, name: "An active rule", isActive: true });
    expect(ruleMatchesSearch(active, "enabled")).toBe(true);
    expect(ruleMatchesSearch(active, "disabled")).toBe(false);
  });

  it("the column helpers summarise what the row displays", () => {
    expect(summariseConditions(r)).toBe("gl account starts with 69");
    expect(ruleGlAccount(r)).toBe("6940");
    expect(ruleVatCode(r)).toBe("Zero Rated");
    expect(summariseActions(r)).toBe("set gl account, set vat code");
  });

  it("several conditions are summarised without hiding that there are more", () => {
    const many = rule({
      id: 3,
      name: "Many conditions",
      conditions: [
        { id: 1, field: "beneficiary", operator: "contains", value: "ABC", value2: null },
        { id: 2, field: "amount", operator: "greater_than", value: "10", value2: null },
      ],
    });
    expect(summariseConditions(many)).toBe("beneficiary contains ABC +1");
  });

  it("a rule with no GL/VAT action reports a placeholder rather than blank cells", () => {
    const bare = rule({ id: 4, name: "Bare rule", actions: [{ id: 9, actionType: "flag_for_review", targetId: null, targetText: null }] });
    expect(ruleGlAccount(bare)).toBe("—");
    expect(ruleVatCode(bare)).toBe("—");
    expect(summariseActions(bare)).toBe("flag for review");
  });

  it("the search box can be cleared in one action", () => {
    render(<BankingRulesTab companyId="co_1" rules={[r]} previewMode />);
    const search = screen.getByLabelText("Search rules");
    fireEvent.change(search, { target: { value: "salary" } });

    fireEvent.click(screen.getByLabelText("Clear search"));

    expect(search).toHaveValue("");
    expect(screen.getByText("Salary rule")).toBeInTheDocument();
  });
});
