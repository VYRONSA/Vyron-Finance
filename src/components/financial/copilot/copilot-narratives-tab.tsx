"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NARRATIVE_TYPES, type CopilotNarrative, type NarrativeType } from "@/server/copilot/types";

function GeneratorForm({
  companyId,
  periodStart,
  periodEnd,
  financialYearStartDate,
  financialYearLabel,
  previewMode,
}: {
  companyId: string;
  periodStart: string;
  periodEnd: string;
  financialYearStartDate: string;
  financialYearLabel: string;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [narrativeType, setNarrativeType] = useState<NarrativeType>("MonthEnd");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/copilot/narratives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narrativeType, periodStart, periodEnd, financialYearStartDate, financialYearLabel }),
      });
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
          <label className="mb-1 block text-xs font-medium text-vf-ink-faint">Narrative Type</label>
          <select value={narrativeType} onChange={(e) => setNarrativeType(e.target.value as NarrativeType)} className="min-w-[220px] rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
            {NARRATIVE_TYPES.map((t) => (
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

function NarrativeCard({ narrative }: { narrative: CopilotNarrative }) {
  const [expanded, setExpanded] = useState(false);
  const content = narrative.content as { facts?: string[]; interpretations?: string[] };
  const facts = content.facts ?? [];
  const interpretations = content.interpretations ?? [];

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="info">{narrative.narrativeType}</Badge>
            <p className="text-sm font-medium text-vf-ink">{narrative.title}</p>
          </div>
          <p className="mt-1 text-xs text-vf-ink-faint">
            Generated {new Date(narrative.generatedAt).toLocaleString()} by {narrative.generatedBy}
          </p>
        </div>
        <Button variant="subtle" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide" : "View"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          {facts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-vf-ink-faint">Facts</p>
              <ul className="mt-1 list-disc pl-4 text-sm text-vf-ink-soft">
                {facts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {interpretations.length > 0 && (
            <div className="rounded-vf-sm bg-vf-info/10 p-2">
              <p className="text-xs font-medium text-vf-ink-faint">Interpretations</p>
              <ul className="mt-1 list-disc pl-4 text-sm text-vf-ink-soft">
                {interpretations.map((int, i) => (
                  <li key={i}>{int}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CopilotNarrativesTab({
  companyId,
  narratives,
  periodStart,
  periodEnd,
  financialYearStartDate,
  financialYearLabel,
  previewMode,
}: {
  companyId: string;
  narratives: CopilotNarrative[];
  periodStart: string;
  periodEnd: string;
  financialYearStartDate: string;
  financialYearLabel: string;
  previewMode: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-vf-ink-faint">
        Plain-language narratives for Month-End, Quarter-End, Year-End, Board Packs, Management Reports, Cash-Flow Commentary, Budget Variance, and
        Profitability — every narrative separates verified Facts from labeled Interpretations.
      </p>
      <GeneratorForm companyId={companyId} periodStart={periodStart} periodEnd={periodEnd} financialYearStartDate={financialYearStartDate} financialYearLabel={financialYearLabel} previewMode={previewMode} />
      {narratives.length === 0 ? (
        <EmptyState title="No narratives generated yet." description="Generate one above — every narrative is built from live data and stays fully traceable." />
      ) : (
        <div className="flex flex-col gap-3">
          {narratives.map((n) => (
            <NarrativeCard key={n.id} narrative={n} />
          ))}
        </div>
      )}
    </div>
  );
}
