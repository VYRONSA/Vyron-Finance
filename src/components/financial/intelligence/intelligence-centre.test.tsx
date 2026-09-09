import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { IntelligenceCentre } from "./intelligence-centre";
import type { BusinessSituation, Finding } from "@/server/financial-intelligence/types";

function finding(overrides: Partial<Finding> & Pick<Finding, "id" | "category" | "severity" | "title">): Finding {
  return {
    description: "Test description",
    evidence: "Test evidence",
    recommendedAction: "Review Something",
    actionHref: "/company/co_1/dashboard",
    source: "Deterministic",
    ...overrides,
  };
}

function situation(overrides: Partial<BusinessSituation> & Pick<BusinessSituation, "id" | "title" | "contributingFindings">): BusinessSituation {
  return {
    summary: "VYRON identified two related conditions: a test condition and another test condition.",
    severity: "High",
    category: "WorkingCapital",
    evidence: overrides.contributingFindings.map((f) => f.evidence),
    recommendedActions: [],
    ...overrides,
  };
}

function renderCentre(findings: Finding[], situations: BusinessSituation[] = []) {
  return render(<IntelligenceCentre companyId="co_1" findings={findings} situations={situations} />);
}

describe("IntelligenceCentre", () => {
  it("renders a single finding with its severity, category, evidence, and recommended action", () => {
    const findings = [finding({ id: "1", category: "VAT", severity: "Critical", title: "VAT liability exists", evidence: "R 4,200.50 VAT payable." })];
    renderCentre(findings);
    expect(screen.getByText("VAT liability exists")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("VAT")).toBeInTheDocument();
    expect(screen.getByText("R 4,200.50 VAT payable.")).toBeInTheDocument();
    expect(screen.getByText(/Review Something/)).toBeInTheDocument();
  });

  it("shows a positive empty state within the Priority Findings card when every finding is Data Quality", () => {
    const findings = [finding({ id: "1", category: "DataQuality", severity: "Medium", title: "No customers added yet" })];
    renderCentre(findings);
    expect(screen.getByText("Nothing here needs attention.")).toBeInTheDocument();
  });

  it("renders multiple severities and never hides evidence for any of them", () => {
    const findings = [
      finding({ id: "1", category: "Banking", severity: "Critical", title: "Critical finding", evidence: "Evidence A" }),
      finding({ id: "2", category: "VAT", severity: "High", title: "High finding", evidence: "Evidence B" }),
      finding({ id: "3", category: "Customers", severity: "Medium", title: "Medium finding", evidence: "Evidence C" }),
      finding({ id: "4", category: "Suppliers", severity: "Low", title: "Low finding", evidence: "Evidence D" }),
    ];
    renderCentre(findings);
    for (const label of ["Critical", "High", "Medium", "Low"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const evidence of ["Evidence A", "Evidence B", "Evidence C", "Evidence D"]) {
      expect(screen.getByText(evidence)).toBeInTheDocument();
    }
  });

  it("filters the Priority Findings list by category when a filter chip is clicked", () => {
    const findings = [
      finding({ id: "1", category: "Banking", severity: "High", title: "Banking finding" }),
      finding({ id: "2", category: "VAT", severity: "Medium", title: "VAT finding" }),
    ];
    renderCentre(findings);
    expect(screen.getByText("Banking finding")).toBeInTheDocument();
    expect(screen.getByText("VAT finding")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^VAT \(1\)$/ }));

    expect(screen.queryByText("Banking finding")).not.toBeInTheDocument();
    expect(screen.getByText("VAT finding")).toBeInTheDocument();
  });

  it("does not show category filter chips when only one category is present", () => {
    const findings = [finding({ id: "1", category: "Banking", severity: "High", title: "Only Banking" })];
    renderCentre(findings);
    expect(screen.queryByRole("group", { name: "Filter by category" })).not.toBeInTheDocument();
  });

  it("shows every finding again after selecting All", () => {
    const findings = [
      finding({ id: "1", category: "Banking", severity: "High", title: "Banking finding" }),
      finding({ id: "2", category: "VAT", severity: "Medium", title: "VAT finding" }),
    ];
    renderCentre(findings);
    fireEvent.click(screen.getByRole("button", { name: /^VAT \(1\)$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^All \(2\)$/ }));
    expect(screen.getByText("Banking finding")).toBeInTheDocument();
    expect(screen.getByText("VAT finding")).toBeInTheDocument();
  });

  it("gives Data Quality findings a visually distinct, separate section with reassuring language", () => {
    const findings = [
      finding({ id: "1", category: "Banking", severity: "High", title: "Banking finding" }),
      finding({ id: "2", category: "DataQuality", severity: "Medium", title: "No suppliers have been added yet" }),
    ];
    renderCentre(findings);
    expect(screen.getByRole("heading", { name: "Data Quality" })).toBeInTheDocument();
    expect(screen.getByText(/don.t necessarily mean something is financially wrong/)).toBeInTheDocument();
    expect(screen.getByText("No suppliers have been added yet")).toBeInTheDocument();
  });

  it("opens the finding detail panel with What/Why/Evidence/Recommended Action/Source when a row is clicked", () => {
    const findings = [
      finding({ id: "1", category: "Banking", severity: "High", title: "3 possible duplicates detected", description: "VYRON has flagged these as possible duplicate payments.", evidence: "3 open PossibleDuplicate exception(s)." }),
    ];
    renderCentre(findings);

    fireEvent.click(screen.getByRole("button", { name: /3 possible duplicates detected/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("What VYRON Found")).toBeInTheDocument();
    expect(within(dialog).getByText("Why It Matters")).toBeInTheDocument();
    expect(within(dialog).getByText("Evidence")).toBeInTheDocument();
    expect(within(dialog).getByText("3 open PossibleDuplicate exception(s).")).toBeInTheDocument();
    expect(within(dialog).getByText("Recommended Action")).toBeInTheDocument();
    expect(within(dialog).getByText("Source")).toBeInTheDocument();
    expect(within(dialog).getByText(/Deterministic — computed directly/)).toBeInTheDocument();
  });

  it("closes the detail panel when Close is clicked", () => {
    const findings = [finding({ id: "1", category: "Banking", severity: "High", title: "A finding" })];
    renderCentre(findings);
    fireEvent.click(screen.getByRole("button", { name: /A finding/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an informational message instead of a fake button when a finding has no recommended action or route", () => {
    const findings = [finding({ id: "1", category: "Banking", severity: "Low", title: "Informational finding", recommendedAction: null, actionHref: null })];
    renderCentre(findings);
    fireEvent.click(screen.getByRole("button", { name: /Informational finding/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Informational — no action needed.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not render a recommended-action button in the row itself when there is none", () => {
    const findings = [finding({ id: "1", category: "Banking", severity: "Low", title: "No action here", recommendedAction: null, actionHref: null })];
    renderCentre(findings);
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it("has no obvious accessibility violations with findings and the detail panel open", async () => {
    const findings = [finding({ id: "1", category: "Banking", severity: "High", title: "A finding" })];
    const { container } = renderCentre(findings);
    fireEvent.click(screen.getByRole("button", { name: /A finding/ }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("IntelligenceCentre — Business Situations (Phase 14)", () => {
  it("does not render a Business Situations section when there are none", () => {
    const findings = [finding({ id: "1", category: "Banking", severity: "High", title: "Banking finding" })];
    renderCentre(findings, []);
    expect(screen.queryByRole("heading", { name: "Business Situations" })).not.toBeInTheDocument();
  });

  it("renders Business Situations above Priority Findings, showing summary, evidence, and related conditions", () => {
    const cashFinding = finding({ id: "cashflow-negative-balance", category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." });
    const customerFinding = finding({ id: "customers-overdue-balance", category: "Customers", severity: "High", title: "Customer balance overdue", evidence: "R 15,000.00 overdue by more than 90 days." });
    const situations = [
      situation({
        id: "situation-cash-collection-pressure",
        title: "Cash Collection Pressure",
        severity: "Critical",
        category: "WorkingCapital",
        summary: "VYRON identified two related conditions: a negative cash position and overdue customer balances.",
        contributingFindings: [cashFinding, customerFinding],
        recommendedActions: [{ label: "Review Customer Aging", href: "/company/co_1/customers" }],
      }),
    ];
    renderCentre([cashFinding, customerFinding], situations);

    const headings = screen.getAllByRole("heading");
    const situationsIndex = headings.findIndex((h) => h.textContent === "Business Situations");
    const priorityIndex = headings.findIndex((h) => h.textContent === "Priority Findings");
    expect(situationsIndex).toBeGreaterThanOrEqual(0);
    expect(priorityIndex).toBeGreaterThan(situationsIndex);

    expect(screen.getByText("Cash Collection Pressure")).toBeInTheDocument();
    expect(screen.getByText(/VYRON identified two related conditions/)).toBeInTheDocument();
    expect(screen.getByText("Total cash: R -500.00.")).toBeInTheDocument();
    expect(screen.getByText("R 15,000.00 overdue by more than 90 days.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review Customer Aging" })).toBeInTheDocument();

    // The two contributing findings still appear in Priority Findings,
    // unhidden — each title now renders twice: once as the situation's
    // Related Conditions tag, once as the real finding row below.
    expect(screen.getAllByText("Cash balance is negative").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Customer balance overdue").length).toBeGreaterThanOrEqual(2);
  });

  it("opens the finding detail panel for a contributing finding when its Related Conditions tag is clicked", () => {
    const cashFinding = finding({ id: "cashflow-negative-balance", category: "CashFlow", severity: "Critical", title: "Cash balance is negative", evidence: "Total cash: R -500.00." });
    const customerFinding = finding({ id: "customers-overdue-balance", category: "Customers", severity: "High", title: "Customer balance overdue" });
    const situations = [situation({ id: "situation-cash-collection-pressure", title: "Cash Collection Pressure", contributingFindings: [cashFinding, customerFinding] })];
    renderCentre([cashFinding, customerFinding], situations);

    fireEvent.click(screen.getAllByRole("button", { name: "Cash balance is negative" })[0]!);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Total cash: R -500.00.")).toBeInTheDocument();
  });

  it("never claims causation in a situation's summary", () => {
    const a = finding({ id: "a", category: "Banking", severity: "High", title: "A" });
    const b = finding({ id: "b", category: "Banking", severity: "High", title: "B" });
    const situations = [situation({ id: "s", title: "Elevated Payment Review Activity", contributingFindings: [a, b] })];
    renderCentre([a, b], situations);
    expect(screen.queryByText(/is causing|caused by|resulted in/i)).not.toBeInTheDocument();
  });

  it("renders multiple simultaneous situations, each with its own severity badge", () => {
    const a = finding({ id: "a", category: "CashFlow", severity: "Critical", title: "A" });
    const b = finding({ id: "b", category: "Customers", severity: "High", title: "B" });
    const c = finding({ id: "c", category: "Suppliers", severity: "High", title: "C" });
    const situations = [
      situation({ id: "s1", title: "Situation One", severity: "Critical", contributingFindings: [a, b] }),
      situation({ id: "s2", title: "Situation Two", severity: "High", contributingFindings: [b, c] }),
    ];
    renderCentre([a, b, c], situations);
    expect(screen.getByText("Situation One")).toBeInTheDocument();
    expect(screen.getByText("Situation Two")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations when Business Situations are present", async () => {
    const a = finding({ id: "a", category: "Banking", severity: "High", title: "A finding" });
    const b = finding({ id: "b", category: "Banking", severity: "High", title: "Another finding" });
    const situations = [situation({ id: "s", title: "A Situation", contributingFindings: [a, b] })];
    const { container } = renderCentre([a, b], situations);
    expect(await axe(container)).toHaveNoViolations();
  });
});
