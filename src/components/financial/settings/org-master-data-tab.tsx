"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

export type OrgMasterDataItem = { id: number; name: string; code: string; address?: string; isActive: boolean };

/**
 * Shared list+add+deactivate UI for Branches, Departments, and Cost
 * Centres — three structurally identical master-data lists (see
 * `server/services/org-master-data-service.ts`, which is the same
 * one-file-not-three shape on the server side). Parametrized by
 * `apiPath`/`resourceLabel` rather than duplicated per resource.
 */
export function OrgMasterDataTab({
  apiPath,
  resourceLabel,
  resourceLabelPlural,
  items,
  hasAddress,
  previewMode,
}: {
  apiPath: string;
  resourceLabel: string;
  resourceLabelPlural: string;
  items: OrgMasterDataItem[];
  hasAddress?: boolean;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, ...(hasAddress ? { address } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setName("");
      setCode("");
      setAddress("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(id: number, isActive: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiPath}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <EmptyState title={`No ${resourceLabelPlural.toLowerCase()} yet.`} description={`Add your first ${resourceLabel.toLowerCase()} below.`} />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Name</TableHeadCell>
              <TableHeadCell>Code</TableHeadCell>
              {hasAddress && <TableHeadCell>Address</TableHeadCell>}
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium text-vf-ink">{item.name}</TableCell>
                <TableCell>{item.code || "—"}</TableCell>
                {hasAddress && <TableCell>{item.address || "—"}</TableCell>}
                <TableCell>
                  <Badge tone={item.isActive ? "good" : "muted"}>{item.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="subtle"
                    size="sm"
                    disabled={loading || previewMode}
                    title={disabledTitle}
                    onClick={() => toggleActive(item.id, item.isActive)}
                  >
                    {item.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-vf-paper-border pt-4">
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor={`${apiPath}-name`}>
            {resourceLabel} Name
          </label>
          <Input id={`${apiPath}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${resourceLabel.toLowerCase()} name`} />
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor={`${apiPath}-code`}>
            Code
          </label>
          <Input id={`${apiPath}-code`} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {hasAddress && (
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor={`${apiPath}-address`}>
              Address
            </label>
            <Input id={`${apiPath}-address`} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        )}
        <Button variant="primary" size="sm" disabled={loading || previewMode || !name.trim()} title={disabledTitle} onClick={handleAdd}>
          Add {resourceLabel}
        </Button>
      </div>

      {error && <p className="text-sm text-vf-danger">{error}</p>}
    </div>
  );
}
