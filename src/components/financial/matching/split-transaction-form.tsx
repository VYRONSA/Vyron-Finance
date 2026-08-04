"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SplitLine = {
  amount: string;
  description: string;
  glAccount: string;
  vatCode: string;
  supplierId: string;
  customerId: string;
  projectId: string;
  costCentreId: string;
  departmentId: string;
  branchId: string;
  inventoryItemId: string;
};

function emptyLine(): SplitLine {
  return { amount: "", description: "", glAccount: "", vatCode: "", supplierId: "", customerId: "", projectId: "", costCentreId: "", departmentId: "", branchId: "", inventoryItemId: "" };
}

function toId(value: string): number | null {
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** "A single imported transaction must support Multiple GL Accounts/
 * Suppliers/Customers/VAT codes/Projects/Cost Centres/Departments/
 * Branches/Inventory Items" — every one of these 8 allocation dimensions
 * already existed end-to-end in the schema/engine/repository; this form
 * previously only exposed GL Account. All 8 are now real, submitted
 * fields — lines must still sum to the transaction's own amount
 * (enforced server-side by `split-transaction-engine.ts`; re-checked
 * here so the user sees a mismatch before submitting). */
export function SplitTransactionForm({ companyId, transactionId, amount, previewMode, onDone }: { companyId: string; transactionId: number; amount: number; previewMode: boolean; onDone: () => void }) {
  const router = useRouter();
  const [lines, setLines] = useState<SplitLine[]>([emptyLine(), emptyLine()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const total = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const balanced = Math.abs(total - amount) < 0.01;

  function updateLine(index: number, field: keyof SplitLine, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transactions/${transactionId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            amount: Number(l.amount),
            description: l.description,
            glAccount: l.glAccount,
            vatCode: l.vatCode || undefined,
            supplierId: toId(l.supplierId),
            customerId: toId(l.customerId),
            projectId: toId(l.projectId),
            costCentreId: toId(l.costCentreId),
            departmentId: toId(l.departmentId),
            branchId: toId(l.branchId),
            inventoryItemId: toId(l.inventoryItemId),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      onDone();
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-vf-ink-faint">
        Split {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} across GL Account, Customer, Supplier, VAT Code, Branch, Department, Cost Centre, Project, and Inventory Item — lines must sum exactly.
      </p>
      {lines.map((line, i) => (
        <div key={i} className="rounded-vf-sm border border-vf-paper-border/70 bg-vf-paper-alt/40 p-2.5">
          <div className="flex flex-wrap items-end gap-2">
            <Input aria-label={`Split ${i + 1} amount`} type="number" step="0.01" placeholder="Amount" value={line.amount} onChange={(e) => updateLine(i, "amount", e.target.value)} className="w-28" />
            <Input aria-label={`Split ${i + 1} GL account`} placeholder="GL Account" value={line.glAccount} onChange={(e) => updateLine(i, "glAccount", e.target.value)} className="w-32" />
            <Input aria-label={`Split ${i + 1} description`} placeholder="Description" value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} className="flex-1 min-w-[160px]" />
            {lines.length > 2 && (
              <Button variant="subtle" size="sm" onClick={() => removeLine(i)}>
                Remove
              </Button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Input aria-label={`Split ${i + 1} VAT code`} placeholder="VAT Code" value={line.vatCode} onChange={(e) => updateLine(i, "vatCode", e.target.value)} className="w-24" />
            <Input aria-label={`Split ${i + 1} customer ID`} type="number" placeholder="Customer ID" value={line.customerId} onChange={(e) => updateLine(i, "customerId", e.target.value)} className="w-28" />
            <Input aria-label={`Split ${i + 1} supplier ID`} type="number" placeholder="Supplier ID" value={line.supplierId} onChange={(e) => updateLine(i, "supplierId", e.target.value)} className="w-28" />
            <Input aria-label={`Split ${i + 1} branch ID`} type="number" placeholder="Branch ID" value={line.branchId} onChange={(e) => updateLine(i, "branchId", e.target.value)} className="w-24" />
            <Input aria-label={`Split ${i + 1} department ID`} type="number" placeholder="Department ID" value={line.departmentId} onChange={(e) => updateLine(i, "departmentId", e.target.value)} className="w-28" />
            <Input aria-label={`Split ${i + 1} cost centre ID`} type="number" placeholder="Cost Centre ID" value={line.costCentreId} onChange={(e) => updateLine(i, "costCentreId", e.target.value)} className="w-28" />
            <Input aria-label={`Split ${i + 1} project ID`} type="number" placeholder="Project ID" value={line.projectId} onChange={(e) => updateLine(i, "projectId", e.target.value)} className="w-24" />
            <Input aria-label={`Split ${i + 1} inventory item ID`} type="number" placeholder="Inventory Item ID" value={line.inventoryItemId} onChange={(e) => updateLine(i, "inventoryItemId", e.target.value)} className="w-32" />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button variant="subtle" size="sm" onClick={addLine}>
          Add Line
        </Button>
        <p className={`text-xs ${balanced ? "text-vf-success" : "text-vf-danger"}`}>
          Total {total.toFixed(2)} of {amount.toFixed(2)} {balanced ? "— balanced" : "— must match exactly"}
        </p>
      </div>
      {error && <p className="text-sm text-vf-danger">{error}</p>}
      <div>
        <Button variant="primary" size="sm" disabled={previewMode || loading || !balanced} title={disabledTitle} onClick={submit}>
          {loading ? "Splitting…" : "Save Split"}
        </Button>
      </div>
    </div>
  );
}
