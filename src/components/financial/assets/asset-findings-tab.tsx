"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { IconMinus, IconRefresh, IconShieldCheck } from "@/components/ui/icons";
import type { AssetFinding, FixedAsset } from "@/server/assets/types";

function FindingCard({ finding, asset, companyId, previewMode }: { finding: AssetFinding; asset: FixedAsset | undefined; companyId: string; previewMode: boolean }) {
  const router = useRouter();
  const [noting, setNoting] = useState<"Resolved" | "Dismissed" | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function submit(status: "Resolved" | "Dismissed") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/assets/findings/${finding.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, note }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setNoting(null);
      setNote("");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={finding.confidence >= 0.75 ? "danger" : "warn"}>{finding.findingType}</Badge>
            <span className="text-xs text-vf-ink-faint">{asset ? `${asset.assetNumber} — ${asset.description}` : `Asset #${finding.assetId}`}</span>
            <span className="text-xs text-vf-ink-faint">{Math.round(finding.confidence * 100)}% confidence</span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-vf-ink">{finding.reason}</p>
        </div>
        {finding.status === "Open" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setNoting("Resolved")}>
              <IconShieldCheck className="h-4 w-4" /> Resolve
            </Button>
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setNoting("Dismissed")}>
              <IconMinus className="h-4 w-4" /> Dismiss
            </Button>
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Evidence</dt>
          <dd className="text-vf-ink-soft">{finding.evidence || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Suggested Action</dt>
          <dd className="text-vf-ink-soft">{finding.suggestedAction || "—"}</dd>
        </div>
      </dl>

      {finding.status !== "Open" && (
        <p className="mt-2 text-xs text-vf-ink-faint">
          {finding.status} by {finding.resolvedBy} {finding.resolvedAt ? `on ${new Date(finding.resolvedAt).toLocaleString()}` : ""}
          {finding.resolutionNote && ` — "${finding.resolutionNote}"`}
        </p>
      )}

      {noting && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
          <Input placeholder="Resolution note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-xs" />
          <Button variant="primary" size="sm" disabled={loading} onClick={() => submit(noting)}>
            Confirm {noting}
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setNoting(null)}>
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
    </div>
  );
}

export function AssetFindingsTab({ companyId, findings, assets, previewMode }: { companyId: string; findings: AssetFinding[]; assets: FixedAsset[]; previewMode: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const assetById = new Map(assets.map((a) => [a.id, a]));

  async function runIntelligence() {
    setRunning(true);
    try {
      await fetch(`/api/companies/${companyId}/assets/findings/run-intelligence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  const open = findings.filter((f) => f.status === "Open");
  const resolved = findings.filter((f) => f.status !== "Open");

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 pt-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-vf-ink-faint">Scans every asset for overdue replacement, underutilisation, maintenance risk, warranty/insurance expiry, unusual depreciation, impairment indicators, idle status, high value, and capitalisation anomalies.</p>
          <Button variant="subtle" size="sm" disabled={previewMode || running} title={disabledTitle} onClick={runIntelligence}>
            <IconRefresh className="h-4 w-4" /> Run Asset Intelligence
          </Button>
        </div>

        {findings.length === 0 ? (
          <EmptyState title="No asset findings." description="Run Asset Intelligence above to scan the Asset Register." />
        ) : (
          <>
            <div>
              <h2 className="mb-3 text-sm font-semibold text-vf-ink">Open ({open.length})</h2>
              {open.length === 0 ? (
                <p className="text-sm text-vf-ink-faint">Nothing awaiting review.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {open.map((f) => (
                    <FindingCard key={f.id} finding={f} asset={assetById.get(f.assetId)} companyId={companyId} previewMode={previewMode} />
                  ))}
                </div>
              )}
            </div>
            {resolved.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-vf-ink">Resolution History ({resolved.length})</h2>
                <div className="flex flex-col gap-3">
                  {resolved.map((f) => (
                    <FindingCard key={f.id} finding={f} asset={assetById.get(f.assetId)} companyId={companyId} previewMode={previewMode} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
