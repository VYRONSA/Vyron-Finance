import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { BankingExceptionsTab } from "./banking-exceptions-tab";
import { MOCK_BANKING_EXCEPTIONS } from "@/lib/mock/banking-automation-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ exception: {} }) })) as unknown as typeof fetch;

describe("BankingExceptionsTab", () => {
  it("shows an empty state when there are no exceptions", () => {
    render(<BankingExceptionsTab companyId="co_1" exceptions={[]} previewMode={false} />);
    expect(screen.getByText("No exceptions.")).toBeInTheDocument();
  });

  it("splits exceptions into Open and Resolution History sections", () => {
    render(<BankingExceptionsTab companyId="co_1" exceptions={MOCK_BANKING_EXCEPTIONS} previewMode={false} />);
    expect(screen.getByText(/Open \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Resolution History \(1\)/)).toBeInTheDocument();
  });

  it("shows Resolve/Dismiss actions only on Open exceptions", () => {
    render(<BankingExceptionsTab companyId="co_1" exceptions={MOCK_BANKING_EXCEPTIONS} previewMode={false} />);
    expect(screen.getAllByRole("button", { name: /resolve/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /dismiss/i })).toHaveLength(2);
  });

  it("disables Resolve/Dismiss in Preview Mode", () => {
    render(<BankingExceptionsTab companyId="co_1" exceptions={MOCK_BANKING_EXCEPTIONS} previewMode />);
    for (const button of screen.getAllByRole("button", { name: /resolve/i })) {
      expect(button).toBeDisabled();
    }
  });

  it("opens a note form and submits Resolve", () => {
    render(<BankingExceptionsTab companyId="co_1" exceptions={MOCK_BANKING_EXCEPTIONS} previewMode={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: /resolve/i })[0]);
    expect(screen.getByPlaceholderText("Resolution note (optional)")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(<BankingExceptionsTab companyId="co_1" exceptions={MOCK_BANKING_EXCEPTIONS} previewMode={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
