import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { BankingRulesTabs } from "./banking-rules-tabs";
import { MOCK_BANKING_RULES } from "@/lib/mock/banking-automation-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("BankingRulesTabs", () => {
  it("shows Rules as the default active tab, listing every rule", () => {
    render(<BankingRulesTabs companyId="co_1" rules={MOCK_BANKING_RULES} previewMode={false} />);
    expect(screen.getByDisplayValue("Fenwick -> Supplier")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Freight -> Distribution")).toBeInTheDocument();
  });

  it("switches to the Analytics tab", () => {
    render(<BankingRulesTabs companyId="co_1" rules={MOCK_BANKING_RULES} previewMode />);
    fireEvent.click(screen.getByRole("button", { name: "Analytics" }));
    expect(screen.getByText(/Analytics reflect real rule-application outcomes/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no rules", () => {
    render(<BankingRulesTabs companyId="co_1" rules={[]} previewMode={false} />);
    expect(screen.getByText("No automation rules yet.")).toBeInTheDocument();
  });

  it("disables Add Rule in Preview Mode", () => {
    render(<BankingRulesTabs companyId="co_1" rules={MOCK_BANKING_RULES} previewMode />);
    expect(screen.getByRole("button", { name: /add rule/i })).toBeDisabled();
  });

  it("shows a Test button (ad-hoc single-record testing) alongside Simulate for every rule", () => {
    render(<BankingRulesTabs companyId="co_1" rules={MOCK_BANKING_RULES} previewMode={false} />);
    expect(screen.getAllByRole("button", { name: "Test" }).length).toBe(MOCK_BANKING_RULES.length);
    expect(screen.getAllByRole("button", { name: "Simulate" }).length).toBe(MOCK_BANKING_RULES.length);
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(<BankingRulesTabs companyId="co_1" rules={MOCK_BANKING_RULES} previewMode={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
