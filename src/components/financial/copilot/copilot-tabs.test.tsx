import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { CopilotTabs } from "./copilot-tabs";
import { SUPPORTED_COPILOT_QUESTIONS } from "@/server/copilot/copilot-assistant-engine";
import { MOCK_COPILOT_BRIEFING, MOCK_COPILOT_NARRATIVES, MOCK_COPILOT_SCENARIOS } from "@/lib/mock/copilot-data";
import { MOCK_FIXED_ASSETS } from "@/lib/mock/asset-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs(previewMode = true) {
  const assetOptions = MOCK_FIXED_ASSETS.map((a) => ({ id: a.id, assetNumber: a.assetNumber, description: a.description }));
  return render(
    <CopilotTabs
      companyId="co_1"
      narratives={MOCK_COPILOT_NARRATIVES}
      scenarios={MOCK_COPILOT_SCENARIOS}
      briefing={MOCK_COPILOT_BRIEFING}
      assetOptions={assetOptions}
      periodStart="2026-05-01"
      periodEnd="2026-05-31"
      financialYearStartDate="2026-01-01"
      financialYearLabel="FY2026"
      previewMode={previewMode}
    />,
  );
}

describe("CopilotTabs", () => {
  it("shows Ask as the default active tab with the supported-question catalog", () => {
    renderTabs();
    expect(screen.getByText(SUPPORTED_COPILOT_QUESTIONS[0].label)).toBeInTheDocument();
  });

  it("switches to the Narratives tab and lists generated narratives", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Narratives" }));
    expect(screen.getByText(MOCK_COPILOT_NARRATIVES[0].title)).toBeInTheDocument();
  });

  it("switches to the What-If tab and lists modeled scenarios", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "What-If" }));
    expect(screen.getByText(MOCK_COPILOT_SCENARIOS[0].name)).toBeInTheDocument();
  });

  it("switches to the Briefing tab and shows the banded scores", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Briefing" }));
    expect(screen.getByText("Financial Health")).toBeInTheDocument();
    expect(screen.getByText("Major Alerts")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
