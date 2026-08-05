import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { BatchEntryGrid, type GridColumn } from "./batch-entry-grid";

type Row = { key: string; description: string; amount: number };

const COLUMNS: GridColumn<Row>[] = [
  { key: "description", label: "Description", type: "text" },
  { key: "amount", label: "Amount", type: "number", align: "right" },
];

function makeRow(key: string, description = "", amount = 0): Row {
  return { key, description, amount };
}

describe("BatchEntryGrid", () => {
  it("renders one row per data item, with a cell per column", () => {
    render(
      <BatchEntryGrid
        columns={COLUMNS}
        rows={[makeRow("a", "First", 100), makeRow("b", "Second", 200)]}
        onRowsChange={vi.fn()}
        createEmptyRow={() => makeRow("new")}
        getRowId={(r) => r.key}
      />,
    );
    expect(screen.getByDisplayValue("First")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Second")).toBeInTheDocument();
    expect(screen.getByDisplayValue("100")).toBeInTheDocument();
  });

  it("shows the empty-state message when there are no rows", () => {
    render(
      <BatchEntryGrid columns={COLUMNS} rows={[]} onRowsChange={vi.fn()} createEmptyRow={() => makeRow("new")} getRowId={(r) => r.key} emptyLabel="Nothing here yet." />,
    );
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("calls onRowsChange with the edited value when a cell changes", () => {
    const onRowsChange = vi.fn();
    render(
      <BatchEntryGrid columns={COLUMNS} rows={[makeRow("a", "First", 100)]} onRowsChange={onRowsChange} createEmptyRow={() => makeRow("new")} getRowId={(r) => r.key} />,
    );
    fireEvent.change(screen.getByDisplayValue("First"), { target: { value: "Updated" } });
    expect(onRowsChange).toHaveBeenCalledWith([{ key: "a", description: "Updated", amount: 100 }]);
  });

  it("appends a new row when Add Row is clicked", () => {
    const onRowsChange = vi.fn();
    render(
      <BatchEntryGrid columns={COLUMNS} rows={[makeRow("a", "First", 100)]} onRowsChange={onRowsChange} createEmptyRow={() => makeRow("new")} getRowId={(r) => r.key} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    expect(onRowsChange).toHaveBeenCalledWith([makeRow("a", "First", 100), makeRow("new")]);
  });

  it("deletes a row when its Delete Row button is clicked", () => {
    const onRowsChange = vi.fn();
    render(
      <BatchEntryGrid columns={COLUMNS} rows={[makeRow("a", "First", 100), makeRow("b", "Second", 200)]} onRowsChange={onRowsChange} createEmptyRow={() => makeRow("new")} getRowId={(r) => r.key} />,
    );
    fireEvent.click(screen.getAllByTitle("Delete row")[0]);
    expect(onRowsChange).toHaveBeenCalledWith([makeRow("b", "Second", 200)]);
  });

  it("duplicates a row when its Duplicate Row button is clicked", () => {
    const onRowsChange = vi.fn();
    render(
      <BatchEntryGrid columns={COLUMNS} rows={[makeRow("a", "First", 100)]} onRowsChange={onRowsChange} createEmptyRow={() => makeRow("new")} getRowId={(r) => r.key} />,
    );
    fireEvent.click(screen.getByTitle("Duplicate row"));
    expect(onRowsChange).toHaveBeenCalledWith([makeRow("a", "First", 100), makeRow("a", "First", 100)]);
  });

  it("hides row-management controls and the Actions column when allowRowManagement is false", () => {
    render(
      <BatchEntryGrid columns={COLUMNS} rows={[makeRow("a", "First", 100)]} onRowsChange={vi.fn()} createEmptyRow={() => makeRow("new")} getRowId={(r) => r.key} allowRowManagement={false} />,
    );
    expect(screen.queryByRole("button", { name: /add row/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete row")).not.toBeInTheDocument();
  });

  it("disables every cell when disabled is true", () => {
    render(
      <BatchEntryGrid columns={COLUMNS} rows={[makeRow("a", "First", 100)]} onRowsChange={vi.fn()} createEmptyRow={() => makeRow("new")} getRowId={(r) => r.key} disabled />,
    );
    expect(screen.getByDisplayValue("First")).toBeDisabled();
  });

  it("renders a totals footer summing the configured numeric columns", () => {
    render(
      <BatchEntryGrid
        columns={COLUMNS}
        rows={[makeRow("a", "First", 100), makeRow("b", "Second", 250)]}
        onRowsChange={vi.fn()}
        createEmptyRow={() => makeRow("new")}
        getRowId={(r) => r.key}
        totals={[{ key: "amount", label: "Amount" }]}
      />,
    );
    expect(screen.getByText(/350[.,]00/)).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(
      <BatchEntryGrid columns={COLUMNS} rows={[makeRow("a", "First", 100)]} onRowsChange={vi.fn()} createEmptyRow={() => makeRow("new")} getRowId={(r) => r.key} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
