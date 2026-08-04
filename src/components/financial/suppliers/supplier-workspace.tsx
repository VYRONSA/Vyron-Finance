"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlus, IconUsers } from "@/components/ui/icons";
import type { Supplier, SupplierRiskRating, SupplierType } from "@/server/accounting/types";

const SUPPLIER_TYPES: SupplierType[] = ["Company", "Individual"];
const RISK_RATINGS: SupplierRiskRating[] = ["Low", "Medium", "High"];
const RISK_TONE: Record<SupplierRiskRating, "good" | "warn" | "danger"> = { Low: "good", Medium: "warn", High: "danger" };

export function SupplierWorkspace({ companyId, suppliers, previewMode }: { companyId: string; suppliers: Supplier[]; previewMode: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [supplierType, setSupplierType] = useState<SupplierType>("Company");
  const [riskRating, setRiskRating] = useState<SupplierRiskRating>("Low");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const apiBase = `/api/companies/${companyId}/suppliers`;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(term) || s.supplierCode.toLowerCase().includes(term) || s.supplierCategory.toLowerCase().includes(term));
  }, [suppliers, search]);

  async function submitCreate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, supplierCode: code, supplierCategory: category, supplierType, riskRating }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setCreating(false);
      setName("");
      setCode("");
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <Input placeholder="Search by code, name, or category…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search suppliers" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setCreating((c) => !c)}>
          <IconPlus className="h-4 w-4" /> {creating ? "Close" : "Add Supplier"}
        </Button>
      </div>

      {creating && (
        <div className="rounded-vf-md border border-vf-paper-border p-4">
          <p className="mb-3 text-sm font-semibold text-vf-ink">New Supplier</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Supplier Code" htmlFor="supp-code">
              <Input id="supp-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="Supplier Name" htmlFor="supp-name" required className="lg:col-span-2">
              <Input id="supp-name" value={name} onChange={(e) => setName(e.target.value)} />
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
          </div>
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
              <TableHeadCell>Code</TableHeadCell>
              <TableHeadCell>Name</TableHeadCell>
              <TableHeadCell>Category</TableHeadCell>
              <TableHeadCell>GL Account</TableHeadCell>
              <TableHeadCell>Risk</TableHeadCell>
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
