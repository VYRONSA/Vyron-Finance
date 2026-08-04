import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { TransactionColumnChooser } from "./transaction-column-chooser";
import { ALL_COLUMN_IDS, COLUMN_LABELS } from "./transaction-grid";

describe("TransactionColumnChooser", () => {
  it("lists every grid column, all checked by default", () => {
    render(<TransactionColumnChooser columnVisibility={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    for (const id of ALL_COLUMN_IDS) {
      expect(screen.getByRole("checkbox", { name: COLUMN_LABELS[id] })).toBeChecked();
    }
  });

  it("reflects an explicitly hidden column as unchecked", () => {
    render(<TransactionColumnChooser columnVisibility={{ merchant: false }} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    expect(screen.getByRole("checkbox", { name: "Merchant" })).not.toBeChecked();
  });

  it("toggles a column's visibility on click", () => {
    const onChange = vi.fn();
    render(<TransactionColumnChooser columnVisibility={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Balance" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const updater = onChange.mock.calls[0][0];
    expect(typeof updater).toBe("function");
    expect(updater({})).toEqual({ balance: false });
  });

  it("closes on Escape", () => {
    render(<TransactionColumnChooser columnVisibility={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    expect(screen.getByRole("group", { name: /choose visible columns/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: /choose visible columns/i })).not.toBeInTheDocument();
  });

  it("has no obvious accessibility violations when open", async () => {
    const { container } = render(<TransactionColumnChooser columnVisibility={{}} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
