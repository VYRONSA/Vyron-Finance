import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { BankingRulesTabs } from "./banking-rules-tabs";
import { MOCK_BANKING_RULES } from "@/lib/mock/banking-automation-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/test",
  useSearchParams: () => new URLSearchParams(),
}));

describe("BankingRulesTabs", () => {
  // Phase 5G — rules are rows in one scrollable list now, so they are
  // located by their visible name rather than by an always-mounted
  // editable input.
  it("shows Rules as the default active tab, listing every rule", () => {
    render(<BankingRulesTabs companyId="co_1" rules={MOCK_BANKING_RULES} previewMode={false} />);
    for (const r of MOCK_BANKING_RULES) {
      expect(screen.getByText(r.name)).toBeInTheDocument();
    }
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

  // Phase 5G — Test and Simulate belong to the rule's editor, which now
  // opens on demand instead of every rule mounting one. The capability
  // is unchanged; what changed is that it no longer costs 100+ open
  // forms to have it. Opening one rule must expose exactly one of each.
  it("opening a rule exposes its Test and Simulate controls (one editor at a time)", () => {
    render(<BankingRulesTabs companyId="co_1" rules={MOCK_BANKING_RULES} previewMode={false} />);
    expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(MOCK_BANKING_RULES[0]!.name) }));

    expect(screen.getAllByRole("button", { name: "Test" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Simulate" })).toHaveLength(1);
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(<BankingRulesTabs companyId="co_1" rules={MOCK_BANKING_RULES} previewMode={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
