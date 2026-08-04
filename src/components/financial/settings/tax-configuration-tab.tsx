"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { VAT_TYPES, type VatTreatment, type VatType } from "@/server/company-management/types";

/** Tax Configuration — the 6 seeded treatments are ported 1:1 from
 * `accounting_engine/vat_codes.py`'s VAT_CODES/VAT_RATES (Standard Rated
 * 15%, Zero Rated/Exempt/No VAT/Fuel VAT 0%, Import VAT 15%); this tab
 * lets rates be edited and custom treatments added, which the reference
 * app never allowed (it was a fixed constant tuple, no CRUD). */
export function TaxConfigurationTab({
  companyId,
  vatTreatments,
  previewMode,
}: {
  companyId: string;
  vatTreatments: VatTreatment[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRate, setEditRate] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newRate, setNewRate] = useState("0");
  const [newVatType, setNewVatType] = useState<VatType>("Standard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/companies/${companyId}/vat-treatments`;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function saveRate(id: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate: Number(editRate) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setEditingId(null);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  async function addTreatment() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode, name: newCode, rate: Number(newRate), vatType: newVatType }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setNewCode("");
      setNewRate("0");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHead>
          <tr>
            <TableHeadCell>Treatment</TableHeadCell>
            <TableHeadCell>Type</TableHeadCell>
            <TableHeadCell>Rate</TableHeadCell>
            <TableHeadCell>Status</TableHeadCell>
            <TableHeadCell className="text-right">
              <span className="sr-only">Actions</span>
            </TableHeadCell>
          </tr>
        </TableHead>
        <TableBody>
          {vatTreatments.map((vat) => (
            <TableRow key={vat.id}>
              <TableCell className="font-medium text-vf-ink">{vat.name}</TableCell>
              <TableCell>
                <Badge tone="muted">{vat.vatType}</Badge>
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {editingId === vat.id ? (
                  <Input className="w-20" value={editRate} onChange={(e) => setEditRate(e.target.value)} />
                ) : (
                  `${vat.rate.toFixed(2)}%`
                )}
              </TableCell>
              <TableCell>
                <Badge tone={vat.isActive ? "good" : "muted"}>{vat.isActive ? "Active" : "Inactive"}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {editingId === vat.id ? (
                  <div className="flex justify-end gap-2">
                    <Button variant="primary" size="sm" disabled={loading} onClick={() => saveRate(vat.id)}>
                      Save
                    </Button>
                    <Button variant="subtle" size="sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="subtle"
                    size="sm"
                    disabled={previewMode}
                    title={disabledTitle}
                    onClick={() => {
                      setEditingId(vat.id);
                      setEditRate(String(vat.rate));
                    }}
                  >
                    Edit Rate
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-end gap-2 border-t border-vf-paper-border pt-4">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="vat-code">Custom Treatment Name</label>
          <Input id="vat-code" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. Reduced Rate" />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="vat-rate">Rate %</label>
          <Input id="vat-rate" value={newRate} onChange={(e) => setNewRate(e.target.value)} />
        </div>
        <div className="w-40">
          <label className="mb-1 block text-xs font-medium text-vf-ink-soft" htmlFor="vat-type">VAT Type</label>
          <Select id="vat-type" value={newVatType} onChange={(e) => setNewVatType(e.target.value as VatType)}>
            {VAT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
        <Button variant="primary" size="sm" disabled={loading || previewMode || !newCode.trim()} title={disabledTitle} onClick={addTreatment}>
          Add Treatment
        </Button>
      </div>

      {error && <p className="text-sm text-vf-danger">{error}</p>}
    </div>
  );
}
