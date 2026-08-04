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
import { IconBuilding, IconPlus } from "@/components/ui/icons";
import type { Customer, CustomerType, RiskRating } from "@/server/customer-management/types";

const CUSTOMER_TYPES: CustomerType[] = ["Company", "Individual"];
const RISK_RATINGS: RiskRating[] = ["Low", "Medium", "High"];
const RISK_TONE: Record<RiskRating, "good" | "warn" | "danger"> = { Low: "good", Medium: "warn", High: "danger" };

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CustomerWorkspace({ companyId, customers, previewMode }: { companyId: string; customers: Customer[]; previewMode: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((c) => c.customerCode.toLowerCase().includes(term) || c.name.toLowerCase().includes(term) || c.customerGroup.toLowerCase().includes(term));
  }, [customers, search]);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <Input placeholder="Search by code, name, or group…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
        </div>
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setCreating((c) => !c)}>
          <IconPlus className="h-4 w-4" /> {creating ? "Close" : "Add Customer"}
        </Button>
      </div>

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
              <TableHeadCell>Code</TableHeadCell>
              <TableHeadCell>Name</TableHeadCell>
              <TableHeadCell>Type</TableHeadCell>
              <TableHeadCell>Group</TableHeadCell>
              <TableHeadCell className="text-right">Credit Limit</TableHeadCell>
              <TableHeadCell>Risk</TableHeadCell>
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
