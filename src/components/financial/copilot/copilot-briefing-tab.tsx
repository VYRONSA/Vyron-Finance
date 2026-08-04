"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { CopilotBriefing } from "@/server/copilot/types";
import type { ExecutiveBriefing, ScoreBand } from "@/server/copilot/executive-briefing-engine";

function bandTone(label: ScoreBand["label"]) {
  return label === "Strong" ? "good" : label === "Adequate" ? "info" : label === "Weak" ? "warn" : "danger";
}

function ScoreTile({ label, band }: { label: string; band: ScoreBand }) {
  return (
    <div className="rounded-vf-md border border-vf-paper-border p-3">
      <p className="text-xs font-medium text-vf-ink-faint">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-lg font-medium text-vf-ink">{band.score}%</span>
        <Badge tone={bandTone(band.label)}>{band.label}</Badge>
      </div>
    </div>
  );
}

function BriefingView({ briefing }: { briefing: CopilotBriefing }) {
  const content = briefing.content as unknown as ExecutiveBriefing;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-vf-ink-faint">
        Generated {new Date(briefing.generatedAt).toLocaleString()} by {briefing.generatedBy} for {briefing.briefingDate}. Every statement below is
        traceable to live data.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <ScoreTile label="Financial Health" band={content.financialHealth} />
        <ScoreTile label="Business Risk" band={content.businessRisk} />
        <ScoreTile label="Audit Readiness" band={content.auditReadiness} />
        <ScoreTile label="Compliance" band={content.compliance} />
        <ScoreTile label="Asset Health" band={content.assetHealth} />
        <div className="rounded-vf-md border border-vf-paper-border p-3">
          <p className="text-xs font-medium text-vf-ink-faint">Cash Position</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-lg font-medium text-vf-ink">{content.cashPosition.current}</span>
            <Badge tone={content.cashPosition.trend === "Improving" ? "good" : "warn"}>{content.cashPosition.trend}</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-vf-ink-faint">Major Alerts</p>
          {content.majorAlerts.length === 0 ? (
            <p className="mt-1 text-sm text-vf-ink-faint">None.</p>
          ) : (
            <ul className="mt-1 list-disc pl-4 text-sm text-vf-ink-soft">
              {content.majorAlerts.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-vf-ink-faint">Opportunities</p>
          {content.opportunities.length === 0 ? (
            <p className="mt-1 text-sm text-vf-ink-faint">None identified today.</p>
          ) : (
            <ul className="mt-1 list-disc pl-4 text-sm text-vf-ink-soft">
              {content.opportunities.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-vf-ink-faint">Recommended Actions</p>
          {content.recommendedActions.length === 0 ? (
            <p className="mt-1 text-sm text-vf-ink-faint">No actions recommended today.</p>
          ) : (
            <ul className="mt-1 list-disc pl-4 text-sm text-vf-ink-soft">
              {content.recommendedActions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function CopilotBriefingTab({
  companyId,
  briefing,
  financialYearStartDate,
  previewMode,
}: {
  companyId: string;
  briefing: CopilotBriefing | null;
  financialYearStartDate: string;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function generateToday() {
    setLoading(true);
    setError(null);
    try {
      const briefingDate = new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/companies/${companyId}/copilot/briefings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefingDate, financialYearStartDate }),
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
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-vf-ink-faint">
            A daily briefing composed entirely from real, already-computed scores — Financial Health, Business Risk, Cash Position, Compliance,
            Audit Readiness, plus Major Alerts, Opportunities, and Recommended Actions.
          </p>
          <Button variant="primary" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={generateToday}>
            {loading ? "Generating…" : "Generate Today's Briefing"}
          </Button>
        </div>
        {error && <p className="text-sm text-vf-danger">{error}</p>}

        {briefing ? <BriefingView briefing={briefing} /> : <EmptyState title="No briefing generated yet." description="Generate today's briefing above." />}
      </CardContent>
    </Card>
  );
}
