"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AUDIT_WORKING_PAPER_TYPES, type AuditWorkingPaper, type AuditWorkingPaperType } from "@/server/audit/types";

function GeneratorForm({ companyId, engagementId, periodStart, periodEnd, previewMode }: { companyId: string; engagementId: number | null; periodStart: string; periodEnd: string; previewMode: boolean }) {
  const router = useRouter();
  const [paperType, setPaperType] = useState<AuditWorkingPaperType>("LeadSchedule");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { paperType, engagementId, asOfDate: periodEnd, dateFrom: periodStart, dateTo: periodEnd, periodStart, periodEnd };
      const res = await fetch(`/api/companies/${companyId}/audit/working-papers/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
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
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 pt-6">
        <div>
          <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Working Paper Type</label>
          <select value={paperType} onChange={(e) => setPaperType(e.target.value as AuditWorkingPaperType)} className="min-w-[220px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
            {AUDIT_WORKING_PAPER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={generate}>
          Generate from Live Data
        </Button>
        {error && <p className="text-sm text-vf-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}

function PaperCard({ paper }: { paper: AuditWorkingPaper }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="info">{paper.paperType}</Badge>
            <p className="text-sm font-medium text-vf-ink">{paper.title}</p>
          </div>
          <p className="mt-1 text-xs text-vf-ink-faint">Generated {new Date(paper.generatedAt).toLocaleString()} by {paper.generatedBy}</p>
        </div>
        <Button variant="subtle" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide" : "View"}
        </Button>
      </div>
      {expanded && (
        <pre className="mt-3 max-h-96 overflow-auto rounded-vf-sm bg-vf-ink/5 p-3 text-xs text-vf-ink-soft">{JSON.stringify(paper.content, null, 2)}</pre>
      )}
    </div>
  );
}

export function AuditWorkingPapersTab({
  companyId,
  engagementId,
  workingPapers,
  periodStart,
  periodEnd,
  previewMode,
}: {
  companyId: string;
  engagementId: number | null;
  workingPapers: AuditWorkingPaper[];
  periodStart: string;
  periodEnd: string;
  previewMode: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <GeneratorForm companyId={companyId} engagementId={engagementId} periodStart={periodStart} periodEnd={periodEnd} previewMode={previewMode} />
      {workingPapers.length === 0 ? (
        <EmptyState title="No working papers generated yet." description="Generate one above — every paper is built from live data and stays fully traceable." />
      ) : (
        <div className="flex flex-col gap-3">
          {workingPapers.map((p) => (
            <PaperCard key={p.id} paper={p} />
          ))}
        </div>
      )}
    </div>
  );
}
