"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PipelineStageResult } from "@/server/services/supplier-reconciliation-service";
import type { Supplier } from "@/server/accounting/types";

// Finding #155 — a run previously always processed 100% of the
// company's open bills/bank transactions with no way to narrow scope.
// All three fields are optional; leaving them blank runs unscoped,
// exactly as before.
export function GenerateReportsButton({ companyId, suppliers, previewMode }: { companyId: string; suppliers: Supplier[]; previewMode: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [stages, setStages] = useState<PipelineStageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scoping, setScoping] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierId, setSupplierId] = useState("");

  async function handleClick() {
    setLoading(true);
    setError(null);
    setStages(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/supplier-reconciliation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          supplierId: supplierId ? Number(supplierId) : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setStages(body.stageResults);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  if (previewMode) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="primary" disabled title="Available once a production Supabase project is connected">
          Generate Supplier Allocation Reports
        </Button>
        <p className="text-xs text-vf-on-dark-faint">Runs against real data once Supabase is configured.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {scoping && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-white/15 bg-white/5 p-2.5">
          <div>
            <label htmlFor="gr-from" className="mb-1 block text-xs text-vf-on-dark-faint">From</label>
            <Input id="gr-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
          </div>
          <div>
            <label htmlFor="gr-to" className="mb-1 block text-xs text-vf-on-dark-faint">To</label>
            <Input id="gr-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
          </div>
          <div>
            <label htmlFor="gr-supplier" className="mb-1 block text-xs text-vf-on-dark-faint">Supplier</label>
            <select
              id="gr-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="min-w-[160px] rounded-vf-sm border border-white/15 bg-transparent px-3 py-2 text-sm text-vf-on-dark"
            >
              <option value="">All suppliers</option>
              {/* Phase 38 — scoping a run to an Inactive/deactivated
               * duplicate supplier would only ever produce an empty,
               * meaningless result. */}
              {suppliers.filter((s) => s.status === "Active").map((s) => (
                <option key={s.id} value={s.id} className="text-vf-ink">
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button variant="ghostDark" size="sm" onClick={() => setScoping((s) => !s)}>
          {scoping ? "Hide Scope" : "Scope Run…"}
        </Button>
        <Button variant="primary" onClick={handleClick} disabled={loading}>
          {loading ? "Running Matching → Allocation → Work Queue…" : "Generate Supplier Allocation Reports"}
        </Button>
      </div>
      {error && <p className="text-xs text-vf-danger">{error}</p>}
      {stages && (
        <ul className="text-xs text-vf-on-dark-soft">
          {stages.map((s) => (
            <li key={s.stage}>
              {s.stage}: {s.succeeded ? `${s.processedCount} processed` : `failed — ${s.error}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
