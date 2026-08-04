import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { RecurringTemplatesTab } from "./recurring-templates-tab";
import { MOCK_RECURRING_TEMPLATES } from "@/lib/mock/automation-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

describe("RecurringTemplatesTab", () => {
  it("shows an empty state when there are no templates", () => {
    render(<RecurringTemplatesTab companyId="co_1" templates={[]} previewMode={false} />);
    expect(screen.getByText("No recurring templates yet.")).toBeInTheDocument();
  });

  it("lists every template with its document type and next run date", () => {
    render(<RecurringTemplatesTab companyId="co_1" templates={MOCK_RECURRING_TEMPLATES} previewMode={false} />);
    expect(screen.getByText("Meridian Traders — Monthly Retainer")).toBeInTheDocument();
    expect(screen.getByText("Recurring Customer Invoice")).toBeInTheDocument();
    expect(screen.getAllByText(/Next run/).length).toBeGreaterThan(0);
  });

  it("opens the New Recurring Template form", () => {
    render(<RecurringTemplatesTab companyId="co_1" templates={[]} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /add template/i }));
    expect(screen.getByText("New Recurring Template")).toBeInTheDocument();
  });

  it("disables Add Template and per-template actions in Preview Mode", () => {
    render(<RecurringTemplatesTab companyId="co_1" templates={MOCK_RECURRING_TEMPLATES} previewMode />);
    expect(screen.getByRole("button", { name: /add template/i })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /generate now/i })[0]).toBeDisabled();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(<RecurringTemplatesTab companyId="co_1" templates={MOCK_RECURRING_TEMPLATES} previewMode={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
