"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowUp, IconPlus, IconUsers } from "@/components/ui/icons";
import { filterAndSort, SortableHeadCell, type SortState } from "@/components/financial/matching/sortable-document-table";
import { DownloadTemplateButton } from "@/components/financial/shared/download-template-button";
import { useUrlParam } from "@/hooks/use-url-param";
import type { Supplier, SupplierRiskRating, SupplierType } from "@/server/accounting/types";
import { SUPPLIER_IMPORT_TEMPLATE_HEADERS } from "@/server/import-centre/customer-supplier-import-parser";
import { Combobox } from "@/components/ui/combobox";
import { glAccountOptions, vatCodeOptions } from "@/lib/account-picker-options";
import { FormSection, validateSupplierForm, type SupplierFormErrors } from "@/components/financial/master-data-form";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";

const SUPPLIER_TYPES: SupplierType[] = ["Company", "Individual"];
const RISK_RATINGS: SupplierRiskRating[] = ["Low", "Medium", "High"];
const RISK_TONE: Record<SupplierRiskRating, "good" | "warn" | "danger"> = { Low: "good", Medium: "warn", High: "danger" };
const ALL = "All";
type StatusFilter = "Active" | "Inactive" | typeof ALL;
type RiskFilter = SupplierRiskRating | typeof ALL;

export function SupplierWorkspace({
  companyId,
  suppliers,
  chartOfAccounts,
  vatTreatments,
  previewMode,
}: {
  companyId: string;
  suppliers: Supplier[];
  chartOfAccounts: ChartOfAccount[];
  vatTreatments: VatTreatment[];
  previewMode: boolean;
}) {
  const router = useRouter();
  // Finding #251 (RC-5) — search survives a refresh and participates in
  // Back/Forward instead of resetting.
  const [search, setSearch] = useUrlParam("q", "");
  // Finding #100 — status/risk filters, previously entirely absent.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>(ALL);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [supplierType, setSupplierType] = useState<SupplierType>("Company");
  const [riskRating, setRiskRating] = useState<SupplierRiskRating>("Low");
  // Phase 5I — `defaultGlAccount` and `defaultVatCode` are the two fields
  // the Allocation Engine reads to code a supplier's bank payments
  // (`allocation-engine.ts`). Until now they could only be set by
  // reopening the supplier after creating it, so every supplier created
  // here started un-codeable. Capturing them up front changes nothing
  // about how allocation works — only when the values exist.
  const [defaultGlAccount, setDefaultGlAccount] = useState<string | null>(null);
  const [defaultVatCode, setDefaultVatCode] = useState<string | null>(null);
  const [vatNumber, setVatNumber] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const glOptions = glAccountOptions(chartOfAccounts);
  const vatOptions = vatCodeOptions(vatTreatments);
  const supplierErrors = validateSupplierForm({ name, vatNumber, registrationNumber, contactEmail });
  const supplierField = (key: keyof SupplierFormErrors) => (attempted ? supplierErrors[key] : undefined);
  /** Phase 5I — a name-based duplicate warning. The server only refuses a
   * duplicate supplier CODE, and the code is optional, so two suppliers
   * with the same name are accepted silently today. This warns before
   * saving without blocking it: genuinely distinct suppliers can share a
   * name, so this is advice, not a rule, and no server behaviour changes. */
  const duplicateName = name.trim()
    ? suppliers.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase())
    : undefined;

  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const apiBase = `/api/companies/${companyId}/suppliers`;

  const [sort, setSort] = useState<SortState<keyof Supplier & string>>({ field: "name", direction: "asc" });
  function toggleSort(field: keyof Supplier & string) {
    setSort((current) => (!current || current.field !== field ? { field, direction: "asc" } : { field, direction: current.direction === "asc" ? "desc" : "asc" }));
  }

  const filtered = useMemo(() => {
    const statusAndRiskFiltered = suppliers.filter((s) => {
      if (statusFilter !== ALL && s.status !== statusFilter) return false;
      if (riskFilter !== ALL && s.riskRating !== riskFilter) return false;
      return true;
    });
    return filterAndSort(statusAndRiskFiltered, search, sort, (s) => `${s.name} ${s.supplierCode} ${s.supplierCategory}`);
  }, [suppliers, statusFilter, riskFilter, search, sort]);

  async function submitCreate() {
    setAttempted(true);
    if (Object.keys(supplierErrors).length > 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          supplierCode: code,
          supplierCategory: category,
          supplierType,
          riskRating,
          defaultGlAccount,
          defaultVatCode,
          vatNumber: vatNumber.trim(),
          registrationNumber: registrationNumber.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      // Phase 5I — the contact goes to the existing satellite endpoint,
      // exactly as the detail panel already does. Optional, and a failure
      // must not discard the supplier that was created successfully.
      const created = data.supplier;
      if (created?.id && (contactName.trim() || contactEmail.trim() || contactPhone.trim())) {
        const res2 = await fetch(`${apiBase}/${created.id}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: contactName.trim() || name.trim(), email: contactEmail.trim(), phone: contactPhone.trim(), isPrimary: true }),
        }).catch(() => null);
        if (!res2 || !res2.ok) {
          setError("The supplier was created, but its contact could not be saved. Add it from the supplier's own page.");
        }
      }
      setCreating(false);
      setName("");
      setCode("");
      setDefaultGlAccount(null);
      setDefaultVatCode(null);
      setVatNumber("");
      setRegistrationNumber("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setAttempted(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(supplier: Supplier) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${supplier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: supplier.status !== "Active" }),
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

  // Finding #039 (RC-12) — bulk CSV import.
  // Phase 33 — `duplicates`/`warnings` are new, real fields
  // `bulkImportSuppliers` now actually returns (see that function's own
  // Phase 33 note) — not invented here.
  const [importOutcome, setImportOutcome] = useState<{ created: number; duplicates: number; failed: number; errors: string[]; warnings: string[] } | null>(null);
  // Phase 33 — a dedicated error slot for the import flow, separate from
  // the generic `error` state Create Supplier/Deactivate already use, so
  // an "Import failed" banner can be shown reliably without risking a
  // create/deactivate failure being mislabeled as an import failure (or
  // vice versa).
  const [importError, setImportError] = useState<string | null>(null);
  async function handleImportFile(file: File) {
    setImportOutcome(null);
    setImportError(null);
    try {
      const csvText = await file.text();
      const res = await fetch(`${apiBase}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csvText }) });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setImportOutcome(data.outcome);
      router.refresh();
    } catch {
      setImportError("Couldn't reach the API. Check the dev server is running.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <Input placeholder="Search by code, name, or category…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search suppliers" />
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
          <IconPlus className="h-4 w-4" /> {creating ? "Close" : "Add Supplier"}
        </Button>
        {/* Phase 32 — "a user must never have to guess what columns an
         * import requires." Headers come straight from the parser's own
         * exported constant, never a hand-copied list. */}
        <DownloadTemplateButton filename="PRECISIA_Supplier_Import_Template.csv" headers={SUPPLIER_IMPORT_TEMPLATE_HEADERS} />
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
        {/* Finding #097 — see customer-workspace.tsx's identical note. */}
        <Button href={`/company/${companyId}/matching?tab=duplicate-detection`} variant="subtle" size="sm">
          Merge Duplicates
        </Button>
      </div>
      <p className="text-xs text-vf-ink-faint">
        Download the template, complete it, and upload it here. Only <span className="font-medium text-vf-ink-soft">Name</span> is required — the rest is optional.
        {" "}Payment Terms (Days): whole number (leave blank for the default of 30 days).
      </p>

      {/* Phase 33 — the previous confirmation was a single, muted-tone
       * paragraph identical whether 0 or 100 suppliers were imported,
       * with nothing distinguishing success from failure. The user
       * couldn't tell a completed import from a still-in-progress one
       * and re-imported the same file, creating duplicate suppliers (see
       * `bulkImportSuppliers`'s own Phase 33 note for the actual
       * duplicate-prevention fix). Every count below is a real field
       * `bulkImportSuppliers` returns — never invented. */}
      {importOutcome && (
        <Card className={importOutcome.failed > 0 ? "border-vf-warning/50" : "border-vf-success/40"}>
          <CardHeader>
            <CardTitle className={importOutcome.failed > 0 ? "text-[#93601f]" : "text-[#1f6e4b]"}>
              {importOutcome.failed > 0 ? "Import completed with warnings" : "Import completed successfully"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="grid max-w-md grid-cols-3 gap-2">
              <div className="flex flex-col gap-1 rounded-vf-md bg-vf-success/14 px-3 py-2.5 text-[#1f6e4b]">
                <span className="text-2xl font-semibold tabular-nums">{importOutcome.created}</span>
                <span className="text-xs font-medium uppercase tracking-wide opacity-80">Imported</span>
              </div>
              <div className="flex flex-col gap-1 rounded-vf-md bg-vf-paper-alt px-3 py-2.5 text-vf-ink-faint">
                <span className="text-2xl font-semibold tabular-nums">{importOutcome.duplicates}</span>
                <span className="text-xs font-medium uppercase tracking-wide opacity-80">Duplicates</span>
              </div>
              <div className={`flex flex-col gap-1 rounded-vf-md px-3 py-2.5 ${importOutcome.failed > 0 ? "bg-vf-danger/14 text-vf-danger" : "bg-vf-paper-alt text-vf-ink-faint"}`}>
                <span className="text-2xl font-semibold tabular-nums">{importOutcome.failed}</span>
                <span className="text-xs font-medium uppercase tracking-wide opacity-80">Failed</span>
              </div>
            </div>
            {importOutcome.duplicates > 0 && (
              <p className="text-xs text-vf-ink-faint">
                {importOutcome.duplicates} row(s) matched an existing supplier by name and were not re-imported.
              </p>
            )}
            {importOutcome.errors.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-vf-ink-soft">Rows that failed:</p>
                <ul className="list-disc pl-5 text-xs text-vf-danger">
                  {importOutcome.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {importError && (
        <Card className="border-vf-danger/50">
          <CardHeader>
            <CardTitle className="text-vf-danger">Import failed</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-vf-ink-soft">{importError}</p>
          </CardContent>
        </Card>
      )}

      {creating && (
        <div className="rounded-vf-md border border-vf-paper-border p-4">
          <p className="mb-3 text-sm font-semibold text-vf-ink">New Supplier</p>
          {/* Phase 5I — grouped, and now capturing the fields the rest of
              the system actually needs from a supplier at creation time. */}
          <FormSection title="Basic Information">
            <Field label="Supplier Name" htmlFor="supp-name" required className="lg:col-span-2" error={supplierField("name")}>
              <Input id="supp-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Supplier Code" htmlFor="supp-code">
              <Input id="supp-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="Category" htmlFor="supp-category">
              <Input id="supp-category" value={category} onChange={(e) => setCategory(e.target.value)} />
            </Field>
            <Field label="Supplier Type" htmlFor="supp-type">
              <Select id="supp-type" value={supplierType} onChange={(e) => setSupplierType(e.target.value as SupplierType)}>
                {SUPPLIER_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Risk Rating" htmlFor="supp-risk">
              <Select id="supp-risk" value={riskRating} onChange={(e) => setRiskRating(e.target.value as SupplierRiskRating)}>
                {RISK_RATINGS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </Field>
          </FormSection>

          <FormSection title="Tax Information">
            <Field label="VAT Number" htmlFor="supp-vat" error={supplierField("vatNumber")}>
              <Input id="supp-vat" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="10 digits" />
            </Field>
            <Field label="Registration Number" htmlFor="supp-reg" error={supplierField("registrationNumber")}>
              <Input id="supp-reg" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} placeholder="YYYY/NNNNNN/NN" />
            </Field>
          </FormSection>

          {/* These two are what the Allocation Engine reads to code this
              supplier's bank payments. Optional, but a supplier without
              them cannot be auto-coded. */}
          <FormSection title="Accounting Defaults">
            <Field label="Default GL Account" htmlFor="supp-gl" className="lg:col-span-2">
              <Combobox aria-label="Default GL Account" value={defaultGlAccount} options={glOptions} placeholder="Search account…" onCommit={setDefaultGlAccount} />
            </Field>
            <Field label="Default VAT Code" htmlFor="supp-vatcode">
              <Combobox aria-label="Default VAT Code" value={defaultVatCode} options={vatOptions} placeholder="Search VAT code…" onCommit={setDefaultVatCode} />
            </Field>
          </FormSection>

          <FormSection title="Contact Information">
            <Field label="Contact Person" htmlFor="supp-contact">
              <Input id="supp-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="supp-email" error={supplierField("contactEmail")}>
              <Input id="supp-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </Field>
            <Field label="Telephone" htmlFor="supp-phone">
              <Input id="supp-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </Field>
          </FormSection>

          {duplicateName && (
            <p role="status" className="mt-3 text-sm text-vf-warning">
              A supplier named &ldquo;{duplicateName.name}&rdquo; already exists{duplicateName.supplierCode ? ` (${duplicateName.supplierCode})` : ""}. Check
              this is not the same one before creating a second record.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" disabled={loading || !name.trim()} onClick={submitCreate}>
              Create Supplier
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
        <EmptyState icon={<IconUsers className="h-5 w-5" />} title="No suppliers found." description="Add your first supplier above." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <SortableHeadCell field="supplierCode" sort={sort} onSort={toggleSort}>Code</SortableHeadCell>
              <SortableHeadCell field="name" sort={sort} onSort={toggleSort}>Name</SortableHeadCell>
              <TableHeadCell>Category</TableHeadCell>
              <TableHeadCell>GL Account</TableHeadCell>
              <SortableHeadCell field="riskRating" sort={sort} onSort={toggleSort}>Risk</SortableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs text-vf-ink-faint">{s.supplierCode || "—"}</TableCell>
                <TableCell className="font-medium text-vf-ink">
                  <a href={`/company/${companyId}/suppliers/${s.id}`} className="text-vf-red-600 hover:underline">
                    {s.name}
                  </a>
                </TableCell>
                <TableCell>{s.supplierCategory || "—"}</TableCell>
                <TableCell>{s.defaultGlAccount || "—"}</TableCell>
                <TableCell>
                  <Badge tone={RISK_TONE[s.riskRating]}>{s.riskRating}</Badge>
                </TableCell>
                <TableCell>
                  <Badge tone={s.status === "Active" ? "good" : "muted"}>{s.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button href={`/company/${companyId}/suppliers/${s.id}`} variant="subtle" size="sm">
                      Open
                    </Button>
                    <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => toggleActive(s)}>
                      {s.status === "Active" ? "Deactivate" : "Reactivate"}
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
