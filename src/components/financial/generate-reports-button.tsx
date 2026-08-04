"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { PipelineStageResult } from "@/server/services/supplier-reconciliation-service";

export function GenerateReportsButton({ companyId, previewMode }: { companyId: string; previewMode: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [stages, setStages] = useState<PipelineStageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    setStages(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/supplier-reconciliation/run`, { method: "POST" });
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
      <Button variant="primary" onClick={handleClick} disabled={loading}>
        {loading ? "Running Matching → Allocation → Work Queue…" : "Generate Supplier Allocation Reports"}
      </Button>
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
