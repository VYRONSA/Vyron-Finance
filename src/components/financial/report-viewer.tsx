"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowDown, IconChevronLeft, IconListChecks } from "@/components/ui/icons";
import { SortableHeadCell, useSearchAndSort } from "@/components/financial/matching/sortable-document-table";
import type {
  DuplicatePaymentRow,
  OutstandingSupplierRow,
  SupplierAllocationRow,
  SupplierPaymentRow,
  UnknownPaymentRow,
} from "@/server/accounting/reconciliation-report-shapes";

type ReportRows = {
  "supplier-allocation": SupplierAllocationRow[];
  "supplier-payment": SupplierPaymentRow[];
  "outstanding-suppliers": OutstandingSupplierRow[];
  "unknown-payments": UnknownPaymentRow[];
  "duplicate-payments": DuplicatePaymentRow[];
};

type ReportType = keyof ReportRows;

const TABS: { type: ReportType; label: string }[] = [
  { type: "supplier-allocation", label: "Supplier Allocation" },
  { type: "supplier-payment", label: "Supplier Payment" },
  { type: "outstanding-suppliers", label: "Outstanding Suppliers" },
  { type: "unknown-payments", label: "Unknown Payments" },
  { type: "duplicate-payments", label: "Duplicate Payments" },
];

const PAGE_SIZE = 50;

function money(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Finding #052 — none of these 5 reports had search/sort/pagination/
 * export; the underlying repository queries are already `LIST_CAP`-capped
 * (see `supplier-reconciliation-repository.ts`), and every row is
 * already fetched into `cache` before this ever renders, so all of this
 * is client-side over already-loaded data — no new fetch needed. */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const lines = [headers.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportToolbar({
  search,
  setSearch,
  page,
  setPage,
  pageCount,
  totalCount,
  onExport,
}: {
  search: string;
  setSearch: (v: string) => void;
  page: number;
  setPage: (v: number) => void;
  pageCount: number;
  totalCount: number;
  onExport: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <Input aria-label="Search" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-64" />
      <div className="flex items-center gap-2">
        <Button variant="subtle" size="sm" onClick={onExport} disabled={totalCount === 0}>
          <IconArrowDown className="h-4 w-4" /> Export CSV
        </Button>
        {pageCount > 1 && (
          <div className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
            <Button variant="subtle" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <IconChevronLeft className="h-3.5 w-3.5" />
            </Button>
            Page {page} of {pageCount}
            <Button variant="subtle" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              <IconChevronLeft className="h-3.5 w-3.5 rotate-180" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyReport() {
  return (
    <EmptyState
      icon={<IconListChecks className="h-5 w-5" />}
      title="No rows for this report yet."
      description="Run Generate Supplier Allocation Reports above once transactions have been imported and matched."
    />
  );
}

function SupplierAllocationTable({ rows }: { rows: SupplierAllocationRow[] }) {
  const { search, setSearch, sort, toggleSort, result } = useSearchAndSort(rows, (r) => `${r.supplier} ${r.invoiceNumber} ${r.reason}`, "date");
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
  const pageRows = result.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (rows.length === 0) return <EmptyReport />;
  return (
    <div>
      <ReportToolbar
        search={search}
        setSearch={setSearch}
        page={page}
        setPage={setPage}
        pageCount={pageCount}
        totalCount={result.length}
        onExport={() =>
          downloadCsv(
            "supplier-allocation-report.csv",
            ["Date", "Supplier", "Invoice", "Debit", "Status", "GL Account", "VAT Code", "Reason"],
            result.map((r) => [r.date ?? "", r.supplier, r.invoiceNumber, r.debit.toFixed(2), r.allocationStatus, r.glAccount ?? "", r.vatCode ?? "", r.reason]),
          )
        }
      />
      <Table>
        <TableHead>
          <tr>
            <SortableHeadCell field="date" sort={sort} onSort={toggleSort}>Date</SortableHeadCell>
            <SortableHeadCell field="supplier" sort={sort} onSort={toggleSort}>Supplier</SortableHeadCell>
            <TableHeadCell>Invoice</TableHeadCell>
            <SortableHeadCell field="debit" sort={sort} onSort={toggleSort} align="right">Debit</SortableHeadCell>
            <SortableHeadCell field="allocationStatus" sort={sort} onSort={toggleSort}>Status</SortableHeadCell>
            <TableHeadCell>GL / VAT</TableHeadCell>
            <TableHeadCell>Reason</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={i}>
              <TableCell>{row.date ?? "—"}</TableCell>
              <TableCell className="font-medium text-vf-ink">{row.supplier}</TableCell>
              <TableCell>{row.invoiceNumber || "—"}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(row.debit)}</TableCell>
              <TableCell>{row.allocationStatus}</TableCell>
              <TableCell>{[row.glAccount, row.vatCode].filter(Boolean).join(" / ") || "—"}</TableCell>
              <TableCell className="text-vf-ink-faint">{row.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SupplierPaymentTable({ rows }: { rows: SupplierPaymentRow[] }) {
  const { search, setSearch, sort, toggleSort, result } = useSearchAndSort(rows, (r) => r.supplierName, "supplierName");
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
  const pageRows = result.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (rows.length === 0) return <EmptyReport />;
  return (
    <div>
      <ReportToolbar
        search={search}
        setSearch={setSearch}
        page={page}
        setPage={setPage}
        pageCount={pageCount}
        totalCount={result.length}
        onExport={() =>
          downloadCsv(
            "supplier-payment-report.csv",
            ["Supplier", "Payments", "Total Paid"],
            result.map((r) => [r.supplierName, String(r.paymentsCount), r.totalPaid.toFixed(2)]),
          )
        }
      />
      <Table>
        <TableHead>
          <tr>
            <SortableHeadCell field="supplierName" sort={sort} onSort={toggleSort}>Supplier</SortableHeadCell>
            <SortableHeadCell field="paymentsCount" sort={sort} onSort={toggleSort} align="right">Payments</SortableHeadCell>
            <SortableHeadCell field="totalPaid" sort={sort} onSort={toggleSort} align="right">Total Paid</SortableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium text-vf-ink">{row.supplierName}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{row.paymentsCount}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(row.totalPaid)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OutstandingSuppliersTable({ rows }: { rows: OutstandingSupplierRow[] }) {
  const { search, setSearch, sort, toggleSort, result } = useSearchAndSort(rows, (r) => `${r.supplier} ${r.invoiceNumber}`, "outstanding");
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
  const pageRows = result.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (rows.length === 0) return <EmptyReport />;
  return (
    <div>
      <ReportToolbar
        search={search}
        setSearch={setSearch}
        page={page}
        setPage={setPage}
        pageCount={pageCount}
        totalCount={result.length}
        onExport={() =>
          downloadCsv(
            "outstanding-suppliers-report.csv",
            ["Supplier", "Invoice", "Type", "Due", "Outstanding"],
            result.map((r) => [r.supplier, r.invoiceNumber, r.documentType, r.dueDate ?? "", r.outstanding.toFixed(2)]),
          )
        }
      />
      <Table>
        <TableHead>
          <tr>
            <SortableHeadCell field="supplier" sort={sort} onSort={toggleSort}>Supplier</SortableHeadCell>
            <TableHeadCell>Invoice</TableHeadCell>
            <TableHeadCell>Type</TableHeadCell>
            <SortableHeadCell field="dueDate" sort={sort} onSort={toggleSort}>Due</SortableHeadCell>
            <SortableHeadCell field="outstanding" sort={sort} onSort={toggleSort} align="right">Outstanding</SortableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium text-vf-ink">{row.supplier}</TableCell>
              <TableCell>{row.invoiceNumber}</TableCell>
              <TableCell>{row.documentType}</TableCell>
              <TableCell>{row.dueDate ?? "—"}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(row.outstanding)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UnknownPaymentsTable({ rows }: { rows: UnknownPaymentRow[] }) {
  const { search, setSearch, sort, toggleSort, result } = useSearchAndSort(rows, (r) => `${r.beneficiary} ${r.description}`, "date");
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
  const pageRows = result.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (rows.length === 0) return <EmptyReport />;
  return (
    <div>
      <ReportToolbar
        search={search}
        setSearch={setSearch}
        page={page}
        setPage={setPage}
        pageCount={pageCount}
        totalCount={result.length}
        onExport={() =>
          downloadCsv(
            "unknown-payments-report.csv",
            ["Date", "Beneficiary", "Description", "Debit"],
            result.map((r) => [r.date ?? "", r.beneficiary, r.description, r.debit.toFixed(2)]),
          )
        }
      />
      <Table>
        <TableHead>
          <tr>
            <SortableHeadCell field="date" sort={sort} onSort={toggleSort}>Date</SortableHeadCell>
            <SortableHeadCell field="beneficiary" sort={sort} onSort={toggleSort}>Beneficiary</SortableHeadCell>
            <TableHeadCell>Description</TableHeadCell>
            <SortableHeadCell field="debit" sort={sort} onSort={toggleSort} align="right">Debit</SortableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={i}>
              <TableCell>{row.date ?? "—"}</TableCell>
              <TableCell className="font-medium text-vf-ink">{row.beneficiary}</TableCell>
              <TableCell>{row.description}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(row.debit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DuplicatePaymentsTable({ rows }: { rows: DuplicatePaymentRow[] }) {
  const { search, setSearch, sort, toggleSort, result } = useSearchAndSort(rows, (r) => `${r.beneficiary} ${r.invoiceNumber}`, "date");
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
  const pageRows = result.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (rows.length === 0) return <EmptyReport />;
  return (
    <div>
      <ReportToolbar
        search={search}
        setSearch={setSearch}
        page={page}
        setPage={setPage}
        pageCount={pageCount}
        totalCount={result.length}
        onExport={() =>
          downloadCsv(
            "duplicate-payments-report.csv",
            ["Date", "Beneficiary", "Invoice", "Debit"],
            result.map((r) => [r.date ?? "", r.beneficiary, r.invoiceNumber, r.debit.toFixed(2)]),
          )
        }
      />
      <Table>
        <TableHead>
          <tr>
            <SortableHeadCell field="date" sort={sort} onSort={toggleSort}>Date</SortableHeadCell>
            <SortableHeadCell field="beneficiary" sort={sort} onSort={toggleSort}>Beneficiary</SortableHeadCell>
            <TableHeadCell>Invoice</TableHeadCell>
            <SortableHeadCell field="debit" sort={sort} onSort={toggleSort} align="right">Debit</SortableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={i}>
              <TableCell>{row.date ?? "—"}</TableCell>
              <TableCell className="font-medium text-vf-ink">{row.beneficiary}</TableCell>
              <TableCell>{row.invoiceNumber || "—"}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(row.debit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReportTableSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-1 text-vf-ink-faint">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function ReportViewer({
  companyId,
  previewMode,
  initialReports,
}: {
  companyId: string;
  previewMode: boolean;
  initialReports?: ReportRows;
}) {
  const [active, setActive] = useState<ReportType>("supplier-allocation");
  const [cache, setCache] = useState<Partial<ReportRows>>(initialReports ?? {});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectTab(type: ReportType) {
    setActive(type);
    if (previewMode || cache[type]) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/supplier-reconciliation/reports/${type}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setCache((prev) => ({ ...prev, [type]: body.rows }));
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  const rows = cache[active];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reports</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-4 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <Button
              key={tab.type}
              variant={active === tab.type ? "primary" : "subtle"}
              size="sm"
              onClick={() => selectTab(tab.type)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        {loading && <ReportTableSkeleton />}
        {error && <p className="text-sm text-vf-danger">{error}</p>}
        {!loading && !error && rows === undefined && <p className="text-sm text-vf-ink-faint">Select a report.</p>}
        {!loading && !error && rows !== undefined && (
          <ReportTableForType type={active} rows={rows} />
        )}
      </CardContent>
    </Card>
  );
}

function ReportTableForType({ type, rows }: { type: ReportType; rows: ReportRows[ReportType] }) {
  // key={type} — each report has its own row shape/columns, so a fresh
  // component instance per tab keeps each one's search/sort/page state
  // independent rather than leaking between reports.
  switch (type) {
    case "supplier-allocation":
      return <SupplierAllocationTable key={type} rows={rows as SupplierAllocationRow[]} />;
    case "supplier-payment":
      return <SupplierPaymentTable key={type} rows={rows as SupplierPaymentRow[]} />;
    case "outstanding-suppliers":
      return <OutstandingSuppliersTable key={type} rows={rows as OutstandingSupplierRow[]} />;
    case "unknown-payments":
      return <UnknownPaymentsTable key={type} rows={rows as UnknownPaymentRow[]} />;
    case "duplicate-payments":
      return <DuplicatePaymentsTable key={type} rows={rows as DuplicatePaymentRow[]} />;
  }
}
