import { describe, expect, it } from "vitest";
import { filterAndSort } from "./sortable-document-table";

type Row = { id: number; label: string; amount: number; date: string | null };

const ROWS: Row[] = [
  { id: 1, label: "INV-100", amount: 500, date: "2026-07-01" },
  { id: 2, label: "INV-002", amount: 1500, date: "2026-07-15" },
  { id: 3, label: "INV-030", amount: 250, date: null },
];

describe("filterAndSort — Finding #030 (RC-6)", () => {
  it("returns every row when search is blank", () => {
    expect(filterAndSort(ROWS, "", null, (r) => r.label)).toHaveLength(3);
  });

  it("filters case-insensitively via the given searchText accessor", () => {
    const result = filterAndSort(ROWS, "inv-002", null, (r) => r.label);
    expect(result.map((r) => r.id)).toEqual([2]);
  });

  it("sorts ascending by a numeric field", () => {
    const result = filterAndSort(ROWS, "", { field: "amount", direction: "asc" }, (r) => r.label);
    expect(result.map((r) => r.id)).toEqual([3, 1, 2]);
  });

  it("sorts descending by a string field", () => {
    const result = filterAndSort(ROWS, "", { field: "label", direction: "desc" }, (r) => r.label);
    expect(result.map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it("sorts null values last regardless of direction", () => {
    const ascending = filterAndSort(ROWS, "", { field: "date", direction: "asc" }, (r) => r.label);
    expect(ascending[ascending.length - 1].id).toBe(3);

    const descending = filterAndSort(ROWS, "", { field: "date", direction: "desc" }, (r) => r.label);
    expect(descending[descending.length - 1].id).toBe(3);
  });

  it("does not mutate the input array", () => {
    const copy = [...ROWS];
    filterAndSort(ROWS, "", { field: "amount", direction: "asc" }, (r) => r.label);
    expect(ROWS).toEqual(copy);
  });
});
