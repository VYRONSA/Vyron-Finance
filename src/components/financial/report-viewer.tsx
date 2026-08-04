"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { IconListChecks } from "@/components/ui/icons";
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

function money(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ReportTable({ type, rows }: { type: ReportType; rows: ReportRows[ReportType] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<IconListChecks className="h-5 w-5" />}
        title="No rows for this report yet."
        description="Run Generate Supplier Allocation Reports above once transactions have been imported and matched."
      />
    );
  }

  if (type === "supplier-allocation") {
    const data = rows as SupplierAllocationRow[];
    return (
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Date</TableHeadCell>
            <TableHeadCell>Supplier</TableHeadCell>
            <TableHeadCell>Invoice</TableHeadCell>
            <TableHeadCell className="text-right">Debit</TableHeadCell>
            <TableHeadCell>Status</TableHeadCell>
            <TableHeadCell>GL / VAT</TableHeadCell>
            <TableHeadCell>Reason</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {data.map((row, i) => (
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
    );
  }

  if (type === "supplier-payment") {
    const data = rows as SupplierPaymentRow[];
    return (
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Supplier</TableHeadCell>
            <TableHeadCell className="text-right">Payments</TableHeadCell>
            <TableHeadCell className="text-right">Total Paid</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {data.map((row, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium text-vf-ink">{row.supplierName}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{row.paymentsCount}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(row.totalPaid)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  if (type === "outstanding-suppliers") {
    const data = rows as OutstandingSupplierRow[];
    return (
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Supplier</TableHeadCell>
            <TableHeadCell>Invoice</TableHeadCell>
            <TableHeadCell>Type</TableHeadCell>
            <TableHeadCell>Due</TableHeadCell>
            <TableHeadCell className="text-right">Outstanding</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {data.map((row, i) => (
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
    );
  }

  if (type === "unknown-payments") {
    const data = rows as UnknownPaymentRow[];
    return (
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Date</TableHeadCell>
            <TableHeadCell>Beneficiary</TableHeadCell>
            <TableHeadCell>Description</TableHeadCell>
            <TableHeadCell className="text-right">Debit</TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {data.map((row, i) => (
            <TableRow key={i}>
              <TableCell>{row.date ?? "—"}</TableCell>
              <TableCell className="font-medium text-vf-ink">{row.beneficiary}</TableCell>
              <TableCell>{row.description}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(row.debit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  const data = rows as DuplicatePaymentRow[];
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Date</TableHeadCell>
          <TableHeadCell>Beneficiary</TableHeadCell>
          <TableHeadCell>Invoice</TableHeadCell>
          <TableHeadCell className="text-right">Debit</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {data.map((row, i) => (
          <TableRow key={i}>
            <TableCell>{row.date ?? "—"}</TableCell>
            <TableCell className="font-medium text-vf-ink">{row.beneficiary}</TableCell>
            <TableCell>{row.invoiceNumber || "—"}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{money(row.debit)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
        {!loading && !error && (rows ? <ReportTable type={active} rows={rows} /> : <p className="text-sm text-vf-ink-faint">Select a report.</p>)}
      </CardContent>
    </Card>
  );
}
