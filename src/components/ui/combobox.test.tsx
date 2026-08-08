import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Combobox, type ComboboxOption } from "./combobox";

const OPTIONS: ComboboxOption<string>[] = [
  { value: "6100", label: "6100", sublabel: "Office Supplies", searchText: "6100 Office Supplies" },
  { value: "6200", label: "6200", sublabel: "Fuel Expenses", searchText: "6200 Fuel Expenses" },
  { value: "6300", label: "6300", sublabel: "Rent Expense", searchText: "6300 Rent Expense" },
];

describe("Combobox", () => {
  it("filters options by typed text (fuzzy over label + sublabel)", () => {
    render(<Combobox value={null} options={OPTIONS} onCommit={() => {}} aria-label="Account" />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Account" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "rent" } });
    expect(screen.getByText("6300")).toBeInTheDocument();
    expect(screen.queryByText("6100")).not.toBeInTheDocument();
    expect(screen.queryByText("6200")).not.toBeInTheDocument();
  });

  it("commits the clicked option", () => {
    const onCommit = vi.fn();
    render(<Combobox value={null} options={OPTIONS} onCommit={onCommit} aria-label="Account" />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Account" }));
    fireEvent.mouseDown(screen.getByText("6100"));
    expect(onCommit).toHaveBeenCalledWith("6100", OPTIONS[0]);
  });

  it("commits the best match on Tab, without preventing native tab order", () => {
    const onCommit = vi.fn();
    render(<Combobox value={null} options={OPTIONS} onCommit={onCommit} aria-label="Account" />);
    const input = screen.getByRole("combobox", { name: "Account" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "6200" } });
    const event = fireEvent.keyDown(input, { key: "Tab" });
    expect(onCommit).toHaveBeenCalledWith("6200", OPTIONS[1]);
    expect(event).toBe(true); // preventDefault() was never called — event was not cancelled
  });

  it("closes without committing on Escape", () => {
    const onCommit = vi.fn();
    render(<Combobox value={null} options={OPTIONS} onCommit={onCommit} aria-label="Account" />);
    const input = screen.getByRole("combobox", { name: "Account" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "rent" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("reverts to the last committed value when typed text matches nothing", () => {
    const onCommit = vi.fn();
    render(<Combobox value="6100" options={OPTIONS} onCommit={onCommit} aria-label="Account" />);
    const input = screen.getByRole("combobox", { name: "Account" }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzz-no-match" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("6100");
  });
});

// Pilot Review Board follow-up — "typing 4400 finds 440000 Sales, typing
// rent finds Rental Expense, typing fuel finds Fuel/Fuel Levy/Fuel
// Expenses, typing spar finds Superspar Eagle Canyon" — locking in the
// exact lookup scenarios named in the review, not just generic filtering.
const GL_OPTIONS: ComboboxOption<string>[] = [
  { value: "440000", label: "440000", sublabel: "Sales", searchText: "440000 Sales" },
  { value: "520000", label: "520000", sublabel: "Rental Expense", searchText: "520000 Rental Expense" },
  { value: "610000", label: "610000", sublabel: "Fuel", searchText: "610000 Fuel" },
  { value: "610100", label: "610100", sublabel: "Fuel Levy", searchText: "610100 Fuel Levy" },
  { value: "610200", label: "610200", sublabel: "Fuel Expenses", searchText: "610200 Fuel Expenses" },
];

const SUPPLIER_OPTIONS: ComboboxOption<string>[] = [
  { value: "1", label: "SUP001", sublabel: "Superspar Eagle Canyon", searchText: "SUP001 Superspar Eagle Canyon" },
  { value: "2", label: "SUP002", sublabel: "Checkers Hyper", searchText: "SUP002 Checkers Hyper" },
  { value: "3", label: "SUP003", sublabel: "Woolworths", searchText: "SUP003 Woolworths" },
];

// Pilot Review Board follow-up — "don't make the user think about
// different lookup controls." Grouped options render in first-
// appearance group order (Customers, then Suppliers, then General
// Ledger, matching the review's own example), even when a lower-group
// option fuzzy-ranks higher than a same-relevance higher-group one.
describe("Combobox — grouped options", () => {
  const GROUPED_OPTIONS: ComboboxOption<string>[] = [
    { value: "c:1", label: "C000145", sublabel: "Superspar Eagle Canyon", group: "Customers", searchText: "C000145 Superspar Eagle Canyon" },
    { value: "s:1", label: "S000087", sublabel: "Superspar Eagle Canyon", group: "Suppliers", searchText: "S000087 Superspar Eagle Canyon" },
    { value: "g:440000", label: "440000", sublabel: "Sales", group: "General Ledger", searchText: "440000 Sales spar" },
  ];

  it("renders group headers in first-appearance order, not fuzzy-rank order", () => {
    render(<Combobox value={null} options={GROUPED_OPTIONS} onCommit={() => {}} aria-label="Account" />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Account" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "spar" } });

    const listbox = screen.getByRole("listbox");
    const headings = Array.from(listbox.querySelectorAll("div")).map((el) => el.textContent);
    const customersIndex = headings.findIndex((h) => h === "Customers");
    const suppliersIndex = headings.findIndex((h) => h === "Suppliers");
    const glIndex = headings.findIndex((h) => h === "General Ledger");
    expect(customersIndex).toBeGreaterThanOrEqual(0);
    expect(customersIndex).toBeLessThan(suppliersIndex);
    expect(suppliersIndex).toBeLessThan(glIndex);
  });

  it("committing a lower-group option still reports the correct value/option pair", () => {
    const onCommit = vi.fn();
    render(<Combobox value={null} options={GROUPED_OPTIONS} onCommit={onCommit} aria-label="Account" />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Account" }));
    fireEvent.mouseDown(screen.getByText("440000"));
    expect(onCommit).toHaveBeenCalledWith("g:440000", GROUPED_OPTIONS[2]);
  });
});

describe("Combobox — named lookup scenarios", () => {
  it("prefix match: '4400' finds '440000 Sales'", () => {
    render(<Combobox value={null} options={GL_OPTIONS} onCommit={() => {}} aria-label="Account" />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Account" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "4400" } });
    expect(screen.getByText("440000")).toBeInTheDocument();
  });

  it("description match: 'rent' finds 'Rental Expense'", () => {
    render(<Combobox value={null} options={GL_OPTIONS} onCommit={() => {}} aria-label="Account" />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Account" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Account" }), { target: { value: "rent" } });
    expect(screen.getByText("Rental Expense")).toBeInTheDocument();
  });

  it("'fuel' surfaces all three Fuel accounts, filtering after the first character", () => {
    render(<Combobox value={null} options={GL_OPTIONS} onCommit={() => {}} aria-label="Account" />);
    const input = screen.getByRole("combobox", { name: "Account" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "f" } });
    expect(screen.getByText("Fuel")).toBeInTheDocument();
    expect(screen.getByText("Fuel Levy")).toBeInTheDocument();
    expect(screen.getByText("Fuel Expenses")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "fuel" } });
    expect(screen.getByText("Fuel")).toBeInTheDocument();
    expect(screen.getByText("Fuel Levy")).toBeInTheDocument();
    expect(screen.getByText("Fuel Expenses")).toBeInTheDocument();
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
  });

  it("supplier lookup: 'spar' finds 'Superspar Eagle Canyon', 'checkers' finds 'Checkers Hyper'", () => {
    render(<Combobox value={null} options={SUPPLIER_OPTIONS} onCommit={() => {}} aria-label="Supplier" />);
    const input = screen.getByRole("combobox", { name: "Supplier" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "spar" } });
    expect(screen.getByText("Superspar Eagle Canyon")).toBeInTheDocument();
    expect(screen.queryByText("Checkers Hyper")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "checkers" } });
    expect(screen.getByText("Checkers Hyper")).toBeInTheDocument();
    expect(screen.queryByText("Superspar Eagle Canyon")).not.toBeInTheDocument();
  });

  it("VAT shorthand: typing '15' commits the Standard-rated treatment without opening a dropdown selection first", () => {
    const onCommit = vi.fn();
    const vatOptions: ComboboxOption<string>[] = [
      { value: "STD", label: "STD", sublabel: "15% · Standard Rated", searchText: "STD Standard Rated 15" },
      { value: "ZER", label: "ZER", sublabel: "0% · Zero Rated", searchText: "ZER Zero Rated 0" },
      { value: "EXM", label: "EXM", sublabel: "0% · Exempt", searchText: "EXM Exempt 0 E" },
    ];
    render(<Combobox value={null} options={vatOptions} onCommit={onCommit} aria-label="VAT" />);
    const input = screen.getByRole("combobox", { name: "VAT" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onCommit).toHaveBeenCalledWith("STD", vatOptions[0]);
  });

  it("VAT shorthand: typing 'E' commits Exempt", () => {
    const onCommit = vi.fn();
    const vatOptions: ComboboxOption<string>[] = [
      { value: "STD", label: "STD", sublabel: "15% · Standard Rated", searchText: "STD Standard Rated 15" },
      { value: "EXM", label: "EXM", sublabel: "0% · Exempt", searchText: "EXM Exempt 0 E" },
    ];
    render(<Combobox value={null} options={vatOptions} onCommit={onCommit} aria-label="VAT" />);
    const input = screen.getByRole("combobox", { name: "VAT" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "E" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onCommit).toHaveBeenCalledWith("EXM", vatOptions[1]);
  });
});
