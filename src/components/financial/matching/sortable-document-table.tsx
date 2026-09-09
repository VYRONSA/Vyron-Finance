"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { TableHeadCell } from "@/components/ui/table";
import { IconArrowDown, IconArrowUp } from "@/components/ui/icons";

/**
 * Master Implementation Tracker — Programme 2, Root Cause RC-6, Finding
 * #030. Customer/Supplier Matching's document tables had no
 * search/sort at all (unlike the rest of the app's list screens); this
 * is a small, self-contained client-side search+sort — the repository
 * layer already caps these lists at `LIST_CAP` (see #030's own
 * investigation), so no server round-trip is needed for either.
 */
export type SortDirection = "asc" | "desc";
export type SortState<Field extends string> = { field: Field; direction: SortDirection } | null;

/** Pure — no DB, no React — filters by substring match on `searchText`
 * then sorts by `sort.field`, nulls/undefined last regardless of
 * direction. Extracted from the hook below so it's directly unit
 * testable without rendering. */
export function filterAndSort<Row extends Record<string, unknown>>(
  rows: Row[],
  search: string,
  sort: SortState<keyof Row & string>,
  searchText: (row: Row) => string,
): Row[] {
  const term = search.trim().toLowerCase();
  const filtered = term ? rows.filter((r) => searchText(r).toLowerCase().includes(term)) : rows;
  if (!sort) return filtered;
  return [...filtered].sort((a, b) => {
    const av = a[sort.field] as string | number | null | undefined;
    const bv = b[sort.field] as string | number | null | undefined;
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const cmp = av < bv ? -1 : 1;
    return sort.direction === "asc" ? cmp : -cmp;
  });
}

export function useSearchAndSort<Row extends Record<string, unknown>>(rows: Row[], searchText: (row: Row) => string, defaultSortField: keyof Row & string) {
  type Field = keyof Row & string;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<Field>>({ field: defaultSortField, direction: "desc" });

  function toggleSort(field: Field) {
    setSort((current) => {
      if (!current || current.field !== field) return { field, direction: "asc" };
      return { field, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  }

  const result = useMemo(() => filterAndSort(rows, search, sort, searchText), [rows, search, sort, searchText]);

  return { search, setSearch, sort, toggleSort, result };
}

export function SortableHeadCell<Field extends string>({
  field,
  sort,
  onSort,
  align = "left",
  children,
}: {
  field: Field;
  sort: SortState<Field>;
  onSort: (field: Field) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = sort?.field === field;
  return (
    <TableHeadCell className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn("inline-flex items-center gap-1 hover:text-vf-ink", align === "right" && "flex-row-reverse")}
      >
        {children}
        {active && (sort.direction === "asc" ? <IconArrowUp className="h-3 w-3" /> : <IconArrowDown className="h-3 w-3" />)}
      </button>
    </TableHeadCell>
  );
}
