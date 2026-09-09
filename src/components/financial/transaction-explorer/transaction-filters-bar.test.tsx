/**
 * Phase 26F — Transaction Explorer top-section compaction. This proves
 * the rebuilt two-line `TransactionFiltersBar` preserves every filter
 * that existed in the old padded, stacked-label, multi-row version
 * (search, date range, amount range, bank account, status, duplicates-
 * only, unknown-supplier-only, apply, reset) and stays accessible even
 * though the visible label lines were removed in favour of `sr-only`
 * labels — never a visual-only shortcut that breaks screen-reader users.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { TransactionFiltersBar, EMPTY_FILTER_DRAFT } from "./transaction-filters-bar";

const BANK_ACCOUNTS = [
  { id: 1, accountName: "Cheque Account" },
  { id: 2, accountName: "Savings Account" },
];

describe("TransactionFiltersBar (Phase 26F compact layout)", () => {
  it("has no accessibility violations despite the visible label lines being removed", async () => {
    const { container } = render(<TransactionFiltersBar bankAccounts={BANK_ACCOUNTS} onApply={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("every field still has a real accessible name (sr-only label, not just a visual placeholder)", () => {
    render(<TransactionFiltersBar bankAccounts={BANK_ACCOUNTS} onApply={() => {}} />);
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("Bank account")).toBeInTheDocument();
    expect(screen.getByLabelText("Min amount")).toBeInTheDocument();
    expect(screen.getByLabelText("Max amount")).toBeInTheDocument();
  });

  it("Apply Filters sends the full current draft, exactly as before — search, dates, amounts, account, statuses, duplicate/unknown-supplier toggles", () => {
    const onApply = vi.fn();
    render(<TransactionFiltersBar bankAccounts={BANK_ACCOUNTS} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "Pick n Pay" } });
    fireEvent.change(screen.getByLabelText("Bank account"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Min amount"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Max amount"), { target: { value: "5000" } });
    fireEvent.click(screen.getByLabelText("Allocated"));
    fireEvent.click(screen.getByLabelText("Duplicates only"));
    fireEvent.click(screen.getByLabelText("Unknown supplier only"));
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));

    expect(onApply).toHaveBeenCalledWith({
      ...EMPTY_FILTER_DRAFT,
      search: "Pick n Pay",
      bankAccountId: 2,
      minAmount: 100,
      maxAmount: 5000,
      statuses: ["Allocated"],
      duplicateOnly: true,
      unknownSupplierOnly: true,
    });
  });

  // Phase 28, Part 13 — the review-workflow filter: "AI Allocations
  // requiring review." Reuses the existing `allocationMethods` field
  // end-to-end (already applied server-side); this is the missing UI
  // piece.
  it("'AI needs review' sets allocationMethods to ['Future AI'], and unchecking clears it back to null", () => {
    const onApply = vi.fn();
    render(<TransactionFiltersBar bankAccounts={BANK_ACCOUNTS} onApply={onApply} />);

    fireEvent.click(screen.getByLabelText("AI needs review"));
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ allocationMethods: ["Future AI"] }));

    fireEvent.click(screen.getByLabelText("AI needs review"));
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ allocationMethods: null }));
  });

  it("Reset clears the 'AI needs review' filter along with everything else", () => {
    const onApply = vi.fn();
    render(<TransactionFiltersBar bankAccounts={BANK_ACCOUNTS} onApply={onApply} />);

    fireEvent.click(screen.getByLabelText("AI needs review"));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(onApply).toHaveBeenLastCalledWith(EMPTY_FILTER_DRAFT);
    expect(screen.getByLabelText("AI needs review")).not.toBeChecked();
  });

  it("pressing Enter in the search field applies filters immediately, same as before", () => {
    const onApply = vi.fn();
    render(<TransactionFiltersBar bankAccounts={BANK_ACCOUNTS} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "fuel" } });
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Enter" });

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ search: "fuel" }));
  });

  it("Reset clears the draft and immediately re-applies the empty filter set", () => {
    const onApply = vi.fn();
    render(<TransactionFiltersBar bankAccounts={BANK_ACCOUNTS} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "something" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(onApply).toHaveBeenLastCalledWith(EMPTY_FILTER_DRAFT);
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });

  it("all four status checkboxes and both extra toggles are present — no filtering capability was dropped", () => {
    render(<TransactionFiltersBar bankAccounts={BANK_ACCOUNTS} onApply={() => {}} />);
    for (const status of ["Matched", "Allocated", "Suggested", "Unallocated"]) {
      expect(screen.getByLabelText(status)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Duplicates only")).toBeInTheDocument();
    expect(screen.getByLabelText("Unknown supplier only")).toBeInTheDocument();
  });

  it("lists every bank account passed in, plus the 'All accounts' default", () => {
    render(<TransactionFiltersBar bankAccounts={BANK_ACCOUNTS} onApply={() => {}} />);
    const select = screen.getByLabelText("Bank account") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["All accounts", "Cheque Account", "Savings Account"]);
  });
});
