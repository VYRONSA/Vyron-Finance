import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { AuditorTabs } from "./auditor-tabs";
import { MOCK_AUDIT_ENGAGEMENTS, MOCK_AUDIT_AREAS, MOCK_AUDIT_RISK_REGISTER, MOCK_AUDIT_TEAM_ASSIGNMENTS, MOCK_AUDIT_FINDINGS, MOCK_AUDIT_WORKING_PAPERS, MOCK_AUDIT_QUERIES } from "@/lib/mock/audit-data";
import { buildAuditDashboardSummary } from "@/server/services/audit-dashboard-summary-service";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs(previewMode = true) {
  const summary = buildAuditDashboardSummary(MOCK_AUDIT_FINDINGS, 84, 2);
  return render(
    <AuditorTabs
      companyId="co_1"
      engagement={MOCK_AUDIT_ENGAGEMENTS[0]}
      summary={summary}
      areas={MOCK_AUDIT_AREAS}
      programmeStepsByArea={{}}
      risks={MOCK_AUDIT_RISK_REGISTER}
      team={MOCK_AUDIT_TEAM_ASSIGNMENTS}
      findings={MOCK_AUDIT_FINDINGS}
      workingPapers={MOCK_AUDIT_WORKING_PAPERS}
      queries={MOCK_AUDIT_QUERIES}
      periodStart="2026-05-01"
      periodEnd="2026-05-31"
      financialYearStartDate="2026-01-01"
      previewMode={previewMode}
    />,
  );
}

describe("AuditorTabs", () => {
  it("shows Dashboard as the default active tab with a real Audit Readiness Score", () => {
    renderTabs();
    expect(screen.getByText("Audit Readiness Score")).toBeInTheDocument();
  });

  it("switches to the Planning tab and shows the engagement's materiality and status", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Planning" }));
    expect(screen.getByText("Materiality")).toBeInTheDocument();
    expect(screen.getByText("Fieldwork")).toBeInTheDocument();
  });

  it("switches to the Findings tab and lists Test findings by default", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Findings" }));
    expect(screen.getByRole("button", { name: /Audit Tests \(18\)/ })).toBeInTheDocument();
  });

  it("switches to the Working Papers tab and lists generated papers", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Working Papers" }));
    expect(screen.getByText(MOCK_AUDIT_WORKING_PAPERS[0].title)).toBeInTheDocument();
  });

  it("switches to the Assistant tab and shows the supported-question catalog", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(screen.getByText("Show all duplicate invoices")).toBeInTheDocument();
  });

  it("switches to the Queries tab and lists saved queries", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Queries" }));
    expect(screen.getByText(MOCK_AUDIT_QUERIES[0].name)).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
