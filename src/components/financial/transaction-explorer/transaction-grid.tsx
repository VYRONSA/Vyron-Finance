"use client";

import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnSizingState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AllocationStatus, BankTransactionRecord } from "@/server/accounting/types";

const STATUS_TONE: Record<AllocationStatus, "good" | "info" | "warn" | "muted"> = {
  Matched: "good",
  Allocated: "info",
  Suggested: "warn",
  Unallocated: "muted",
};

function money(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const helper = createColumnHelper<BankTransactionRecord>();

export const ALL_COLUMN_IDS = [
  "transactionDate", "description", "reference", "debit", "credit", "balance", "bankAccount",
  "merchant", "supplier", "customer", "glAccount", "vatTreatment", "allocationStatus",
  "rulesApplied", "journalStatus", "confidenceScore", "requiredAction",
] as const;

export const COLUMN_LABELS: Record<(typeof ALL_COLUMN_IDS)[number], string> = {
  transactionDate: "Date",
  description: "Description",
  reference: "Reference",
  debit: "Debit",
  credit: "Credit",
  balance: "Balance",
  bankAccount: "Bank Account",
  merchant: "Merchant",
  supplier: "Supplier",
  customer: "Customer",
  glAccount: "GL Account",
  vatTreatment: "VAT Treatment",
  allocationStatus: "Matching Status",
  rulesApplied: "Rule Applied",
  journalStatus: "Journal Status",
  confidenceScore: "Confidence",
  requiredAction: "Recovery Status",
};

const columns = [
  helper.display({
    id: "select",
    size: 40,
    header: ({ table }) => (
      <input
        type="checkbox"
        aria-label="Select all transactions on this page"
        checked={table.getIsAllRowsSelected()}
        ref={(el) => {
          if (el) el.indeterminate = table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected();
        }}
        onChange={table.getToggleAllRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label={`Select transaction ${row.original.id}`}
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        onClick={(e) => e.stopPropagation()}
      />
    ),
  }),
  helper.accessor("transactionDate", { id: "transactionDate", size: 110, header: "Date", cell: (c) => c.getValue() ?? "—" }),
  helper.accessor("description", { id: "description", size: 220, header: "Description", cell: (c) => c.getValue() || "—" }),
  helper.accessor("reference", { id: "reference", size: 130, header: "Reference", cell: (c) => c.getValue() || "—" }),
  helper.accessor("debit", {
    id: "debit", size: 110, header: "Debit",
    cell: (c) => <span className="font-mono tabular-nums">{c.getValue() > 0 ? money(c.getValue()) : "—"}</span>,
  }),
  helper.accessor("credit", {
    id: "credit", size: 110, header: "Credit",
    cell: (c) => <span className="font-mono tabular-nums">{c.getValue() > 0 ? money(c.getValue()) : "—"}</span>,
  }),
  helper.accessor("balance", {
    id: "balance", size: 120, header: "Balance",
    cell: (c) => <span className="font-mono tabular-nums">{money(c.getValue())}</span>,
  }),
  helper.accessor("bankAccount", { id: "bankAccount", size: 130, header: "Bank Account", cell: (c) => c.getValue() || "—" }),
  helper.accessor("matchedMerchantId", {
    id: "merchant", size: 130, header: "Merchant",
    cell: (c) => (
      <span className={c.getValue() !== null ? "text-vf-ink" : "text-vf-ink-faint italic"}>
        {c.getValue() !== null ? "Assigned" : "Not yet identified"}
      </span>
    ),
  }),
  helper.accessor((row) => row.matchedSupplierName ?? row.beneficiary, {
    id: "supplier", size: 180, header: "Supplier",
    cell: (c) => (
      <span className={c.row.original.matchedSupplierName ? "text-vf-ink" : "text-vf-ink-faint italic"}>{c.getValue() || "—"}</span>
    ),
  }),
  helper.display({
    id: "customer", size: 130, header: "Customer",
    cell: () => (
      <span className="text-vf-ink-faint italic" title="No Customer concept exists in this accounting engine — see docs/MIGRATION_ROADMAP.md.">
        Not available
      </span>
    ),
  }),
  helper.accessor("suggestedGlAccount", { id: "glAccount", size: 160, header: "GL Account", cell: (c) => c.getValue() ?? "—" }),
  helper.accessor("suggestedVatCode", { id: "vatTreatment", size: 130, header: "VAT Treatment", cell: (c) => c.getValue() ?? "—" }),
  helper.accessor("allocationStatus", {
    id: "allocationStatus", size: 130, header: "Matching Status",
    cell: (c) => <Badge tone={STATUS_TONE[c.getValue()]}>{c.getValue()}</Badge>,
  }),
  helper.accessor("rulesTriggered", {
    id: "rulesApplied", size: 200, header: "Rule Applied",
    cell: (c) => (c.getValue().length > 0 ? c.getValue().join(", ") : "—"),
  }),
  helper.accessor("journalId", {
    id: "journalStatus", size: 120, header: "Journal Status",
    cell: (c) => (c.getValue() !== null ? <Badge tone="info">Draft</Badge> : "—"),
  }),
  helper.accessor("confidenceScore", {
    id: "confidenceScore", size: 110, header: "Confidence",
    cell: (c) => (c.getValue() !== null ? <span className="font-mono tabular-nums">{c.getValue()!.toFixed(0)}%</span> : "—"),
  }),
  helper.accessor("requiredAction", {
    id: "requiredAction", size: 260, header: "Recovery Status",
    cell: (c) => (c.getValue() ? <Badge tone="warn">{c.getValue()}</Badge> : "—"),
  }),
];

const PINNED_COLUMN_IDS = new Set(["select", "transactionDate"]);

export function TransactionGrid({
  transactions,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  rowSelection,
  onRowSelectionChange,
  columnSizing,
  onColumnSizingChange,
  onRowClick,
  loading,
}: {
  transactions: BankTransactionRecord[];
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((old: SortingState) => SortingState)) => void;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (updater: VisibilityState | ((old: VisibilityState) => VisibilityState)) => void;
  rowSelection: RowSelectionState;
  onRowSelectionChange: (updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => void;
  columnSizing: ColumnSizingState;
  onColumnSizingChange: (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => void;
  onRowClick: (transaction: BankTransactionRecord) => void;
  loading?: boolean;
}) {
  const data = useMemo(() => transactions, [transactions]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, rowSelection, columnSizing },
    onSortingChange,
    onColumnVisibilityChange,
    onRowSelectionChange,
    onColumnSizingChange,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  function leftOffset(columnId: string): number {
    let offset = 0;
    for (const col of table.getVisibleLeafColumns()) {
      if (col.id === columnId) return offset;
      if (PINNED_COLUMN_IDS.has(col.id)) offset += col.getSize();
    }
    return offset;
  }

  return (
    <Table>
      <TableHead sticky>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const pinned = PINNED_COLUMN_IDS.has(header.column.id);
              const sortState = header.column.getIsSorted();
              const sortable = ["transactionDate", "debit", "credit"].includes(header.column.id);
              return (
                <TableHeadCell
                  key={header.id}
                  scope="col"
                  aria-sort={sortable ? (sortState === "asc" ? "ascending" : sortState === "desc" ? "descending" : "none") : undefined}
                  style={{ width: header.getSize(), position: pinned ? "sticky" : undefined, left: pinned ? leftOffset(header.column.id) : undefined }}
                  className={cn("relative select-none whitespace-nowrap", pinned && "z-[2] bg-vf-paper-alt")}
                >
                  {sortable ? (
                    <button type="button" className="flex items-center gap-1" onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sortState === "asc" && <span aria-hidden>↑</span>}
                      {sortState === "desc" && <span aria-hidden>↓</span>}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                  {header.column.getCanResize() && (
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-vf-red-400/40"
                    />
                  )}
                </TableHeadCell>
              );
            })}
          </tr>
        ))}
      </TableHead>
      <TableBody>
        {loading ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-8 text-center text-vf-ink-faint">
              Loading transactions…
            </TableCell>
          </TableRow>
        ) : table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-8 text-center text-vf-ink-faint">
              No transactions match the current filters.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer" onClick={() => onRowClick(row.original)}>
              {row.getVisibleCells().map((cell) => {
                const pinned = PINNED_COLUMN_IDS.has(cell.column.id);
                return (
                  <TableCell
                    key={cell.id}
                    style={{ width: cell.column.getSize(), position: pinned ? "sticky" : undefined, left: pinned ? leftOffset(cell.column.id) : undefined }}
                    className={cn(pinned && "z-[1] bg-vf-paper")}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
