"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArchive, IconPlus } from "@/components/ui/icons";
import type { Warehouse } from "@/server/inventory/types";

function WarehouseFormPanel({ companyId, onDone, onCancel }: { companyId: string; onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/inventory/warehouses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, address }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onDone();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <p className="mb-3 text-sm font-semibold text-vf-ink">New Warehouse</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Code" htmlFor="wh-code" required>
          <Input id="wh-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Name" htmlFor="wh-name" required className="sm:col-span-2">
          <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Address" htmlFor="wh-address" className="sm:col-span-3">
          <Input id="wh-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !code.trim() || !name.trim()} onClick={submit}>
          Create Warehouse
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function WarehousesTab({ companyId, warehouses, previewMode }: { companyId: string; warehouses: Warehouse[]; previewMode: boolean }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/inventory/warehouses`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function runAction(id: number, action: "set-default" | "set-active", extra?: Record<string, unknown>) {
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setShowForm(true)}>
          <IconPlus className="h-4 w-4" /> New Warehouse
        </Button>
      </div>

      {showForm && <WarehouseFormPanel companyId={companyId} onDone={() => { setShowForm(false); router.refresh(); }} onCancel={() => setShowForm(false)} />}

      {error && <p className="text-sm text-vf-danger">{error}</p>}

      {warehouses.length === 0 ? (
        <EmptyState icon={<IconArchive className="h-5 w-5" />} title="No warehouses yet." description="Add the first warehouse above." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Code</TableHeadCell>
              <TableHeadCell>Name</TableHeadCell>
              <TableHeadCell>Address</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {warehouses.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-mono text-xs font-medium text-vf-ink">{w.code}</TableCell>
                <TableCell>{w.name}</TableCell>
                <TableCell>{w.address || "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={w.isActive ? "good" : "muted"}>{w.isActive ? "Active" : "Inactive"}</Badge>
                    {w.isDefault && <Badge tone="info">Default</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {!w.isDefault && (
                      <Button variant="subtle" size="sm" disabled={previewMode || loadingId === w.id} title={disabledTitle} onClick={() => runAction(w.id, "set-default")}>
                        Set Default
                      </Button>
                    )}
                    <Button variant="subtle" size="sm" disabled={previewMode || loadingId === w.id} title={disabledTitle} onClick={() => runAction(w.id, "set-active", { isActive: !w.isActive })}>
                      {w.isActive ? "Deactivate" : "Reactivate"}
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
