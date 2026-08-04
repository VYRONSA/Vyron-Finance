"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSearch } from "@/components/ui/icons";
import type { ChartOfAccount, GlInquiryPage } from "@/server/general-ledger/types";
import type { Branch, CostCentre, Department } from "@/server/company-management/types";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function GlInquiryTab({
  companyId,
  accounts,
  branches,
  departments,
  costCentres,
  initialPage,
  previewMode,
}: {
  companyId: string;
  accounts: ChartOfAccount[];
  branches: Branch[];
  departments: Department[];
  costCentres: CostCentre[];
  initialPage: GlInquiryPage;
  previewMode: boolean;
}) {
  const [page, setPage] = useState(initialPage);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/companies/${companyId}/general-ledger/gl-transactions`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  function buildQuery(cursor: string | null) {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (accountId) params.set("accountId", accountId);
    if (reference) params.set("reference", reference);
    if (search) params.set("search", search);
    if (branchId) params.set("branchId", branchId);
    if (departmentId) params.set("departmentId", departmentId);
    if (costCentreId) params.set("costCentreId", costCentreId);
    if (sourceType) params.set("sourceType", sourceType);
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }

  async function runQuery(cursor: string | null, append: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}?${buildQuery(cursor)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setPage((prev) => (append ? { ...data, transactions: [...prev.transactions, ...data.transactions] } : data));
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-36">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="gl-date-from">From</label>
          <Input id="gl-date-from" type="date" disabled={previewMode} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="gl-date-to">To</label>
          <Input id="gl-date-to" type="date" disabled={previewMode} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="w-48">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="gl-account">Account</label>
          <Select id="gl-account" disabled={previewMode} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.accountCode} — {a.description}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="gl-reference">Reference</label>
          <Input id="gl-reference" disabled={previewMode} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="gl-search">Search</label>
          <Input id="gl-search" disabled={previewMode} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Description or reference…" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => runQuery(null, false)}>
          <IconSearch className="h-4 w-4" /> Apply
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="gl-branch">Branch</label>
          <Select id="gl-branch" disabled={previewMode} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="gl-department">Department</label>
          <Select id="gl-department" disabled={previewMode} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="gl-cost-centre">Cost Centre</label>
          <Select id="gl-cost-centre" disabled={previewMode} value={costCentreId} onChange={(e) => setCostCentreId(e.target.value)}>
            <option value="">All Cost Centres</option>
            {costCentres.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="gl-source">Source</label>
          <Input id="gl-source" disabled={previewMode} value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder="e.g. manual, journal_reversal" />
        </div>
      </div>

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {page.transactions.length === 0 ? (
        <EmptyState icon={<IconSearch className="h-5 w-5" />} title="No postings found." description="Try widening the date range or clearing filters." />
      ) : (
        <>
          <Table>
            <TableHead>
              <tr>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell>Account</TableHeadCell>
                <TableHeadCell>Description</TableHeadCell>
                <TableHeadCell>Reference</TableHeadCell>
                <TableHeadCell>Journal</TableHeadCell>
                <TableHeadCell className="text-right">Debit</TableHeadCell>
                <TableHeadCell className="text-right">Credit</TableHeadCell>
                {page.runningBalances && <TableHeadCell className="text-right">Balance</TableHeadCell>}
              </tr>
            </TableHead>
            <TableBody>
              {page.transactions.map((t, i) => (
                <TableRow key={t.id}>
                  <TableCell>{t.postingDate}</TableCell>
                  <TableCell>
                    <Link href={`/company/${companyId}/general-ledger/${t.accountId}`} className="font-mono text-xs text-vf-red-600 hover:underline">
                      {t.accountCode}
                    </Link>
                    <span className="ml-2 text-xs text-vf-ink-faint">{t.accountDescription}</span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{t.description}</TableCell>
                  <TableCell className="text-xs text-vf-ink-faint">{t.reference}</TableCell>
                  <TableCell className="font-mono text-xs text-vf-ink-faint">{t.journalNumber}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{t.debit > 0 ? money(t.debit) : ""}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{t.credit > 0 ? money(t.credit) : ""}</TableCell>
                  {page.runningBalances && (
                    <TableCell className="text-right font-mono tabular-nums">{money(page.runningBalances[i])}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {page.hasMore && (
            <Button variant="subtle" size="sm" disabled={loading} onClick={() => runQuery(page.nextCursor, true)}>
              {loading ? "Loading…" : "Load More"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
