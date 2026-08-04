"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconRefresh, IconSparkles } from "@/components/ui/icons";
import { isHighRisk, type VatDocument, type VatIntelligenceSignal } from "@/server/vat/vat-intelligence";

export function VatIntelligenceTab({
  companyId,
  signals,
  previewMode,
}: {
  companyId: string;
  signals: { document: VatDocument; signal: VatIntelligenceSignal }[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<{ documentsScanned: number; exceptionsRaised: number; ruleMatches: number } | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function run() {
    setRunning(true);
    setOutcome(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/vat-intelligence/run`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setOutcome(data.outcome);
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  const byDocument = new Map<number, { document: VatDocument; signals: VatIntelligenceSignal[] }>();
  for (const { document, signal } of signals) {
    const group = byDocument.get(document.id) ?? { document, signals: [] };
    group.signals.push(signal);
    byDocument.set(document.id, group);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={previewMode || running} title={disabledTitle} onClick={run}>
          <IconRefresh className="h-4 w-4" /> {running ? "Running…" : "Run VAT Intelligence Now"}
        </Button>
        {outcome && (
          <span className="text-sm text-vf-ink-soft">
            Scanned {outcome.documentsScanned} document(s) — {outcome.exceptionsRaised} exception(s) raised, {outcome.ruleMatches} rule match(es).
          </span>
        )}
      </div>

      {byDocument.size === 0 ? (
        <EmptyState icon={<IconSparkles className="h-5 w-5" />} title="No VAT Intelligence signals right now." description="Every VAT-bearing document scanned so far is clean." />
      ) : (
        <ul className="flex flex-col gap-3">
          {[...byDocument.values()].map(({ document, signals: docSignals }) => (
            <li key={document.id} className="rounded-vf-md border border-vf-paper-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">{document.documentType}</Badge>
                <span className="text-sm font-medium text-vf-ink">#{document.id} — {document.partyName}</span>
                {isHighRisk(docSignals) && <Badge tone="danger">High Risk</Badge>}
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {docSignals.map((s, i) => (
                  <li key={i} className="text-sm text-vf-ink-soft">
                    <span className="font-medium text-vf-ink">{s.message}</span>
                    <span className="ml-1 font-mono text-xs tabular-nums text-vf-ink-faint">({s.confidence}% confidence)</span>
                    <p className="text-xs text-vf-ink-faint">{s.reasoning}</p>
                    <p className="text-xs text-vf-ink-faint">Suggested: {s.suggestedCorrection}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
