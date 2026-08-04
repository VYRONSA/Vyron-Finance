"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlus, IconReceipt } from "@/components/ui/icons";
import type { VatAdjustment, VatAdjustmentDirection, VatAdjustmentTarget } from "@/server/vat/types";
import type { VatTreatment } from "@/server/company-management/types";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function NewAdjustmentForm({ companyId, vatTreatments, onDone, onCancel }: { companyId: string; vatTreatments: VatTreatment[]; onDone: () => void; onCancel: () => void }) {
  const [direction, setDirection] = useState<VatAdjustmentDirection>("Increase");
  const [targetAccount, setTargetAccount] = useState<VatAdjustmentTarget>("VATInput");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [vatTreatmentId, setVatTreatmentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/vat-adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction, targetAccount, amount: Number(amount), reason, adjustmentDate,
          vatTreatmentId: vatTreatmentId ? Number(vatTreatmentId) : null,
        }),
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
      <p className="mb-3 text-sm font-semibold text-vf-ink">New VAT Adjustment</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Direction" htmlFor="adj-direction" required>
          <Select id="adj-direction" value={direction} onChange={(e) => setDirection(e.target.value as VatAdjustmentDirection)}>
            <option value="Increase">Increase</option>
            <option value="Decrease">Decrease</option>
          </Select>
        </Field>
        <Field label="Target" htmlFor="adj-target" required>
          <Select id="adj-target" value={targetAccount} onChange={(e) => setTargetAccount(e.target.value as VatAdjustmentTarget)}>
            <option value="VATInput">VAT Input</option>
            <option value="VATOutput">VAT Output</option>
          </Select>
        </Field>
        <Field label="Amount" htmlFor="adj-amount" required>
          <Input id="adj-amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date" htmlFor="adj-date" required>
          <Input id="adj-date" type="date" value={adjustmentDate} onChange={(e) => setAdjustmentDate(e.target.value)} />
        </Field>
        <Field label="Related VAT Treatment" htmlFor="adj-treatment">
          <Select id="adj-treatment" value={vatTreatmentId} onChange={(e) => setVatTreatmentId(e.target.value)}>
            <option value="">None</option>
            {vatTreatments.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Reason" htmlFor="adj-reason" required>
            <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Correction — VAT claimed twice on invoice INV-3381." />
          </Field>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" disabled={loading || !reason.trim() || !amount} onClick={submit}>
          Create Adjustment
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function VatAdjustmentsTab({ companyId, adjustments, vatTreatments, previewMode }: { companyId: string; adjustments: VatAdjustment[]; vatTreatments: VatTreatment[]; previewMode: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function approve(id: number) {
    setApprovingId(id);
    try {
      await fetch(`/api/companies/${companyId}/vat-adjustments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      router.refresh();
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setCreating((c) => !c)}>
          <IconPlus className="h-4 w-4" /> {creating ? "Close" : "New Adjustment"}
        </Button>
      </div>

      {creating && (
        <NewAdjustmentForm
          companyId={companyId}
          vatTreatments={vatTreatments}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {adjustments.length === 0 ? (
        <EmptyState icon={<IconReceipt className="h-5 w-5" />} title="No VAT adjustments yet." description="Add your first adjustment above." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell>Direction</TableHeadCell>
              <TableHeadCell>Target</TableHeadCell>
              <TableHeadCell className="text-right">Amount</TableHeadCell>
              <TableHeadCell>Reason</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right">Actions</TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {adjustments.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.adjustmentDate}</TableCell>
                <TableCell>{a.direction}</TableCell>
                <TableCell>{a.targetAccount === "VATInput" ? "VAT Input" : "VAT Output"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(a.amount)}</TableCell>
                <TableCell className="max-w-xs truncate">{a.reason}</TableCell>
                <TableCell>
                  <Badge tone={a.status === "Approved" ? "good" : "warn"}>{a.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {a.status === "Draft" && (
                    <Button variant="subtle" size="sm" disabled={previewMode || approvingId === a.id} title={disabledTitle} onClick={() => approve(a.id)}>
                      {approvingId === a.id ? "Approving…" : "Approve & Post"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
