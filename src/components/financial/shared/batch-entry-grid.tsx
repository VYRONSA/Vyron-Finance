"use client";

import { useMemo, useRef } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconCopy, IconPlus, IconTrash } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Pilot Review Round 1, Phase 4 — the one reusable spreadsheet-style
 * batch entry framework every future bulk-capture screen builds on
 * (Cashbook, the Opening Balances Chart-of-Accounts grid, and any
 * later module), rather than a bespoke grid per module. Built on this
 * codebase's existing `Table`/`Input`/`Select` primitives — no new grid
 * library, since none was already a dependency (see research: only
 * `@tanstack/react-table` exists, and it gives column/sizing plumbing
 * but no cell editing, keyboard nav, or paste — all of that is here).
 *
 * Deliberately "dumb": this component owns editing, keyboard navigation,
 * paste-from-Excel, and row add/insert/duplicate/delete. It has no
 * opinion on Draft/Post, validation rules, or persistence — those stay
 * with each caller, matching the existing service/repository split.
 *
 * Keyboard model (disclosed interpretation): Tab/Shift+Tab move
 * left/right using native DOM tab order (already correct for a grid of
 * inputs in row-major order) — Enter and the vertical arrow keys are the
 * only keys this component intercepts. Enter and ArrowDown move focus to
 * the same column, one row down; ArrowUp moves one row up. Pressing
 * Enter (or Tab) in the last cell of the last row appends a new empty
 * row and moves focus into it, so an accountant can keep capturing
 * without ever reaching for the mouse. Left/Right arrows are left to the
 * browser's native text-cursor behaviour inside a cell.
 */
export type GridColumnType = "text" | "number" | "date" | "select";

export type GridColumn<TRow> = {
  key: keyof TRow & string;
  label: string;
  type: GridColumnType;
  options?: { value: string; label: string }[];
  width?: string;
  align?: "left" | "right";
  placeholder?: string;
  /** Returns a non-null reason to render the cell read-only with that
   * reason as its title/tooltip — e.g. "captured via 3 customer entries." */
  readOnlyReason?: (row: TRow) => string | null;
};

export type GridTotal<TRow> = {
  key: keyof TRow & string;
  label: string;
};

export type BatchEntryGridProps<TRow> = {
  columns: GridColumn<TRow>[];
  rows: TRow[];
  onRowsChange: (rows: TRow[]) => void;
  createEmptyRow: () => TRow;
  getRowId: (row: TRow) => string;
  /** Returns a validation message for the row, or null when valid — shown
   * as an inline badge on the row, never blocks typing. */
  validateRow?: (row: TRow) => string | null;
  totals?: GridTotal<TRow>[];
  disabled?: boolean;
  emptyLabel?: string;
  className?: string;
  /** False for a fixed-row spreadsheet (e.g. one row per Chart of
   * Accounts entry) where rows are derived from the data, not
   * user-managed — hides Add/Insert/Duplicate/Delete row and the whole
   * Actions column. Defaults to true (free-form batch capture, e.g.
   * Cashbook). Keyboard navigation and paste behave identically either way. */
  allowRowManagement?: boolean;
};

function parseClipboardGrid(text: string): string[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line, index, all) => !(index === all.length - 1 && line === ""))
    .map((line) => line.split("\t"));
}

export function BatchEntryGrid<TRow extends Record<string, unknown>>({
  columns,
  rows,
  onRowsChange,
  createEmptyRow,
  getRowId,
  validateRow,
  totals,
  disabled = false,
  emptyLabel = "No rows yet — click \"Add Row\" or paste directly from Excel.",
  className,
  allowRowManagement = true,
}: BatchEntryGridProps<TRow>) {
  const cellRefs = useRef<Array<Array<HTMLInputElement | HTMLSelectElement | null>>>([]);

  const totalValues = useMemo(() => {
    if (!totals || totals.length === 0) return null;
    return totals.map((t) => ({
      ...t,
      value: rows.reduce((sum, row) => sum + (Number(row[t.key]) || 0), 0),
    }));
  }, [rows, totals]);

  function updateCell(rowIndex: number, key: keyof TRow & string, value: string | number) {
    const next = rows.slice();
    next[rowIndex] = { ...next[rowIndex], [key]: value };
    onRowsChange(next);
  }

  function addRow() {
    onRowsChange([...rows, createEmptyRow()]);
  }

  function insertRowAt(index: number) {
    const next = rows.slice();
    next.splice(index, 0, createEmptyRow());
    onRowsChange(next);
  }

  function duplicateRowAt(index: number) {
    const next = rows.slice();
    next.splice(index + 1, 0, { ...rows[index] });
    onRowsChange(next);
  }

  function deleteRowAt(index: number) {
    const next = rows.slice();
    next.splice(index, 1);
    onRowsChange(next);
  }

  function focusCell(rowIndex: number, colIndex: number) {
    requestAnimationFrame(() => {
      cellRefs.current[rowIndex]?.[colIndex]?.focus();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent, rowIndex: number, colIndex: number) {
    const isLastRow = rowIndex === rows.length - 1;
    const isLastCol = colIndex === columns.length - 1;

    if (e.key === "Enter") {
      e.preventDefault();
      if (isLastRow) {
        if (allowRowManagement) {
          addRow();
          focusCell(rowIndex + 1, colIndex);
        }
      } else {
        focusCell(rowIndex + 1, colIndex);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      if (rowIndex < rows.length - 1) {
        e.preventDefault();
        focusCell(rowIndex + 1, colIndex);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (rowIndex > 0) {
        e.preventDefault();
        focusCell(rowIndex - 1, colIndex);
      }
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && isLastRow && isLastCol && allowRowManagement) {
      e.preventDefault();
      addRow();
      focusCell(rowIndex + 1, 0);
    }
  }

  function handlePaste(e: React.ClipboardEvent, rowIndex: number, colIndex: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const grid = parseClipboardGrid(text);
    if (grid.length === 0) return;
    if (grid.length === 1 && grid[0].length === 1) return; // single value — let native paste happen

    e.preventDefault();
    const next = rows.slice();
    grid.forEach((lineValues, lineOffset) => {
      const targetRowIndex = rowIndex + lineOffset;
      while (targetRowIndex >= next.length) next.push(createEmptyRow());
      let row = next[targetRowIndex];
      lineValues.forEach((rawValue, valueOffset) => {
        const column = columns[colIndex + valueOffset];
        if (!column) return;
        const value = column.type === "number" ? Number(rawValue.replace(/[^0-9.-]/g, "")) || 0 : rawValue.trim();
        row = { ...row, [column.key]: value };
      });
      next[targetRowIndex] = row;
    });
    onRowsChange(next);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <Table>
        <TableHead sticky>
          <tr>
            {columns.map((col) => (
              <TableHeadCell key={col.key} className={cn(col.width, col.align === "right" && "text-right")}>
                {col.label}
              </TableHeadCell>
            ))}
            {allowRowManagement && <TableHeadCell className="w-32 text-right">Actions</TableHeadCell>}
          </tr>
        </TableHead>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length + (allowRowManagement ? 1 : 0)} className="py-8 text-center text-sm text-vf-ink-faint">
                {emptyLabel}
              </TableCell>
            </TableRow>
          )}
          {rows.map((row, rowIndex) => {
            const rowError = validateRow?.(row) ?? null;
            return (
              <TableRow key={getRowId(row)}>
                {columns.map((col, colIndex) => {
                  const readOnlyReason = col.readOnlyReason?.(row) ?? null;
                  const isReadOnly = disabled || !!readOnlyReason;
                  const rawValue = row[col.key];
                  const commonProps = {
                    ref: (el: HTMLInputElement | HTMLSelectElement | null) => {
                      if (!cellRefs.current[rowIndex]) cellRefs.current[rowIndex] = [];
                      cellRefs.current[rowIndex][colIndex] = el;
                    },
                    disabled: isReadOnly,
                    title: readOnlyReason ?? undefined,
                    "aria-label": `${col.label}, row ${rowIndex + 1}`,
                    onKeyDown: (e: React.KeyboardEvent) => handleKeyDown(e, rowIndex, colIndex),
                    onPaste: (e: React.ClipboardEvent) => handlePaste(e, rowIndex, colIndex),
                    className: cn(
                      "rounded-md border-transparent bg-transparent px-2 py-1.5 text-sm focus:border-vf-red-500 focus:bg-vf-paper",
                      col.align === "right" && "text-right tabular-nums",
                      readOnlyReason && "cursor-not-allowed text-vf-ink-faint italic",
                    ),
                  };
                  return (
                    <TableCell key={col.key} className="p-1">
                      {col.type === "select" ? (
                        <Select
                          {...commonProps}
                          value={String(rawValue ?? "")}
                          onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                        >
                          <option value="">{col.placeholder ?? "Select…"}</option>
                          {col.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          {...commonProps}
                          type={col.type}
                          step={col.type === "number" ? "0.01" : undefined}
                          placeholder={col.placeholder}
                          value={rawValue === 0 && col.type === "number" ? "" : String(rawValue ?? "")}
                          onChange={(e) =>
                            updateCell(rowIndex, col.key, col.type === "number" ? Number(e.target.value) || 0 : e.target.value)
                          }
                        />
                      )}
                    </TableCell>
                  );
                })}
                {allowRowManagement && (
                  <TableCell className="p-1">
                    <div className="flex items-center justify-end gap-1">
                      {rowError && (
                        <span className="mr-1 rounded-full bg-vf-red-50 px-2 py-0.5 text-[11px] font-medium text-vf-red-600" title={rowError}>
                          !
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => duplicateRowAt(rowIndex)}
                        title="Duplicate row"
                        className="rounded-md p-1.5 text-vf-ink-faint transition-colors hover:bg-vf-paper-alt hover:text-vf-ink disabled:pointer-events-none disabled:opacity-40"
                      >
                        <IconCopy className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => insertRowAt(rowIndex)}
                        title="Insert row above"
                        className="rounded-md p-1.5 text-vf-ink-faint transition-colors hover:bg-vf-paper-alt hover:text-vf-ink disabled:pointer-events-none disabled:opacity-40"
                      >
                        <IconPlus className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => deleteRowAt(rowIndex)}
                        title="Delete row"
                        className="rounded-md p-1.5 text-vf-ink-faint transition-colors hover:bg-vf-red-50 hover:text-vf-red-600 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <IconTrash className="size-4" />
                      </button>
                    </div>
                  </TableCell>
                )}
                {!allowRowManagement && rowError && (
                  <TableCell className="p-1 text-right">
                    <span className="rounded-full bg-vf-red-50 px-2 py-0.5 text-[11px] font-medium text-vf-red-600" title={rowError}>
                      !
                    </span>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
        {totalValues && (
          <tfoot>
            <tr className="border-t border-vf-paper-border bg-vf-paper-alt font-semibold">
              <TableCell colSpan={columns.length - totalValues.length}>Totals</TableCell>
              {totalValues.map((t) => (
                <TableCell key={t.key} className="text-right tabular-nums">
                  {t.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
              ))}
              {allowRowManagement && <TableCell />}
            </tr>
          </tfoot>
        )}
      </Table>
      {allowRowManagement && (
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={disabled}>
          <IconPlus className="size-4" /> Add Row
        </Button>
      )}
    </div>
  );
}
