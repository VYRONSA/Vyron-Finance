"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowUp, IconBuilding, IconPlus } from "@/components/ui/icons";
import { filterAndSort, SortableHeadCell, type SortState } from "@/components/financial/matching/sortable-document-table";
import { DownloadTemplateButton } from "@/components/financial/shared/download-template-button";
import { useUrlParam } from "@/hooks/use-url-param";
import type { Customer, CustomerType, RiskRating } from "@/server/customer-management/types";
import { CUSTOMER_IMPORT_TEMPLATE_HEADERS } from "@/server/import-centre/customer-supplier-import-parser";

const CUSTOMER_TYPES: CustomerType[] = ["Company", "Individual"];
const RISK_RATINGS: RiskRating[] = ["Low", "Medium", "High"];
const RISK_TONE: Record<RiskRating, "good" | "warn" | "danger"> = { Low: "good", Medium: "warn", High: "danger" };
const ALL = "All";
type StatusFilter = "Active" | "Inactive" | typeof ALL;
type RiskFilter = RiskRating | typeof ALL;

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CustomerWorkspace({ companyId, customers, previewMode }: { companyId: string; customers: Customer[]; previewMode: boolean }) {
  const router = useRouter();
  // Finding #251 (RC-5) — search survives a refresh and participates in
  // Back/Forward instead of resetting.
  const [search, setSearch] = useUrlParam("q", "");
  // Finding #100 — status/risk filters, previously entirely absent.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>(ALL);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [customerType, setCustomerType] = useState<CustomerType>("Company");
  const [riskRating, setRiskRating] = useState<RiskRating>("Low");
  const [creditLimit, setCreditLimit] = useState("0");
  const [paymentTermsDays, setPaymentTermsDays] = useState("30");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const apiBase = `/api/companies/${companyId}/customers`;

  const [sort, setSort] = useState<SortState<keyof Customer & string>>({ field: "name", direction: "asc" });
  function toggleSort(field: keyof Customer & string) {
    setSort((current) => (!current || current.field !== field ? { field, direction: "asc" } : { field, direction: current.direction === "asc" ? "desc" : "asc" }));
  }

  const filtered = useMemo(() => {
    const statusAndRiskFiltered = customers.filter((c) => {
      if (statusFilter !== ALL && (c.isActive ? "Active" : "Inactive") !== statusFilter) return false;
      if (riskFilter !== ALL && c.riskRating !== riskFilter) return false;
      return true;
    });
    return filterAndSort(statusAndRiskFiltered, search, sort, (c) => `${c.customerCode} ${c.name} ${c.customerGroup}`);
  }, [customers, statusFilter, riskFilter, search, sort]);

  async function submitCreate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerCode: code,
          name,
          customerType,
          riskRating,
          creditLimit: Number(creditLimit) || 0,
          paymentTermsDays: Number(paymentTermsDays) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setCreating(false);
      setCode("");
      setName("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(customer: Customer) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !customer.isActive }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  // Finding #035 (RC-12) — bulk CSV import.
  const [importOutcome, setImportOutcome] = useState<{ created: number; failed: number; errors: string[] } | null>(null);
  async function handleImportFile(file: File) {
    setImportOutcome(null);
    setError(null);
    try {
      const csvText = await file.text();
      const res = await fetch(`${apiBase}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csvText }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setImportOutcome(data.outcome);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <Input placeholder="Search by code, name, or group…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
        </div>
        <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="w-36">
          <option value={ALL}>All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </Select>
        <Select aria-label="Filter by risk rating" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as RiskFilter)} className="w-36">
          <option value={ALL}>All risk ratings</option>
          {RISK_RATINGS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </Select>
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setCreating((c) => !c)}>
          <IconPlus className="h-4 w-4" /> {creating ? "Close" : "Add Customer"}
        </Button>
        {/* Phase 32 — headers come straight from the parser's own
         * exported constant, never a hand-copied list. */}
        <DownloadTemplateButton filename="VYRON_Customer_Import_Template.csv" headers={CUSTOMER_IMPORT_TEMPLATE_HEADERS} />
        <label className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-vf-paper-border px-4 py-2 text-sm font-medium text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600 ${previewMode ? "pointer-events-none opacity-50" : ""}`} title={disabledTitle}>
          <IconArrowUp className="h-4 w-4" /> Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={previewMode}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = "";
            }}
          />
        </label>
        {/* Finding #097 — Matching's Duplicate Detection tab already has
            real merge logic; this is the missing entry point to it from
            the Customers list, not a second merge implementation. */}
        <Button href={`/company/${companyId}/matching?tab=duplicate-detection`} variant="subtle" size="sm">
          Merge Duplicates
        </Button>
      </div>
      <p className="text-xs text-vf-ink-faint">
        Download the template, complete it, and upload it here. Only <span className="font-medium text-vf-ink-soft">Name</span> is required — the rest is optional.
        {" "}VAT Number: 10 digits. Registration Number: format YYYY/NNNNNN/NN. Credit Limit and Payment Terms (Days): whole numbers (leave blank for the default).
      </p>

      {importOutcome && (
        <p className="text-sm text-vf-ink-soft">
          Imported {importOutcome.created} customer(s).
          {importOutcome.failed > 0 && ` ${importOutcome.failed} row(s) failed — see below.`}
        </p>
      )}
      {importOutcome && importOutcome.errors.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-vf-danger">
          {importOutcome.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {creating && (
        <div className="rounded-vf-md border border-vf-paper-border p-4">
          <p className="mb-3 text-sm font-semibold text-vf-ink">New Customer</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Customer Code" htmlFor="cust-code" required>
              <Input id="cust-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="Customer Name" htmlFor="cust-name" required className="lg:col-span-2">
              <Input id="cust-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Customer Type" htmlFor="cust-type">
              <Select id="cust-type" value={customerType} onChange={(e) => setCustomerType(e.target.value as CustomerType)}>
                {CUSTOMER_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Risk Rating" htmlFor="cust-risk">
              <Select id="cust-risk" value={riskRating} onChange={(e) => setRiskRating(e.target.value as RiskRating)}>
                {RISK_RATINGS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Credit Limit" htmlFor="cust-credit">
              <Input id="cust-credit" type="number" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
            </Field>
            <Field label="Payment Terms (days)" htmlFor="cust-terms">
              <Input id="cust-terms" type="number" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" disabled={loading || !code.trim() || !name.trim()} onClick={submitCreate}>
              Create Customer
            </Button>
            <Button variant="subtle" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
        </div>
      )}

      {!creating && error && <p className="text-sm text-vf-danger">{error}</p>}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconBuilding className="h-5 w-5" />} title="No customers found." description="Add your first customer above." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <SortableHeadCell field="customerCode" sort={sort} onSort={toggleSort}>Code</SortableHeadCell>
              <SortableHeadCell field="name" sort={sort} onSort={toggleSort}>Name</SortableHeadCell>
              <TableHeadCell>Type</TableHeadCell>
              <TableHeadCell>Group</TableHeadCell>
              <SortableHeadCell field="creditLimit" sort={sort} onSort={toggleSort} align="right">Credit Limit</SortableHeadCell>
              <SortableHeadCell field="riskRating" sort={sort} onSort={toggleSort}>Risk</SortableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs text-vf-ink-faint">
                  <Link href={`/company/${companyId}/customers/${c.id}`} className="text-vf-red-600 hover:underline">
                    {c.customerCode}
                  </Link>
                </TableCell>
                <TableCell className="font-medium text-vf-ink">{c.name}</TableCell>
                <TableCell>{c.customerType}</TableCell>
                <TableCell>{c.customerGroup || "—"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(c.creditLimit)}</TableCell>
                <TableCell>
                  <Badge tone={RISK_TONE[c.riskRating]}>{c.riskRating}</Badge>
                </TableCell>
                <TableCell>
                  <Badge tone={c.isActive ? "good" : "muted"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button href={`/company/${companyId}/customers/${c.id}`} variant="subtle" size="sm">
                      Open
                    </Button>
                    <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => toggleActive(c)}>
                      {c.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
