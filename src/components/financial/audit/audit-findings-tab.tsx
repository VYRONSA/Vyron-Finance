"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { IconMinus, IconRefresh, IconShieldCheck } from "@/components/ui/icons";
import type { AuditFinding, AuditFindingCategory, AuditFindingSeverity } from "@/server/audit/types";
import { SendCommunicationButton } from "@/components/financial/communications/send-communication-button";

const SEVERITY_TONE: Record<AuditFindingSeverity, "info" | "warn" | "danger"> = { Low: "info", Medium: "info", High: "warn", Critical: "danger" };

function FindingCard({ finding, companyId, previewMode }: { finding: AuditFinding; companyId: string; previewMode: boolean }) {
  const router = useRouter();
  const [noting, setNoting] = useState<"Reviewed" | "Dismissed" | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function submit(status: "Reviewed" | "Dismissed") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/audit/findings/${finding.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
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
            <Badge tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</Badge>
            <span className="text-xs font-medium text-vf-ink-faint">{finding.findingType}</span>
            <span className="text-xs text-vf-ink-faint">{Math.round(finding.confidence * 100)}% confidence</span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-vf-ink">{finding.reason}</p>
        </div>
        {finding.status === "Open" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => setNoting("Reviewed")}>
              <IconShieldCheck className="h-4 w-4" /> Mark Reviewed
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
          <dt className="text-xs font-medium text-vf-ink-faint">Suggested Audit Procedure</dt>
          <dd className="text-vf-ink-soft">{finding.suggestedProcedure || "—"}</dd>
        </div>
      </dl>

      {finding.status !== "Open" && (
        <p className="mt-2 text-xs text-vf-ink-faint">
          {finding.status} by {finding.reviewedBy} {finding.reviewedAt ? `on ${new Date(finding.reviewedAt).toLocaleString()}` : ""}
          {finding.reviewNote && ` — "${finding.reviewNote}"`}
        </p>
      )}

      {noting && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
          <Input placeholder="Review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-xs" />
          <Button variant="primary" size="sm" disabled={loading} onClick={() => submit(noting)}>
            Confirm {noting}
          </Button>
          <Button variant="subtle" size="sm" onClick={() => setNoting(null)}>
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-vf-paper-border pt-3">
        <Input placeholder="Send to email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} className="max-w-xs" />
        <SendCommunicationButton
          key={recipientEmail}
          companyId={companyId}
          module="Auditor"
          businessObjectType="AuditFinding"
          businessObjectId={finding.id}
          recipients={[{ type: "Email", name: recipientEmail || "Recipient", address: recipientEmail || null }]}
          previewMode={previewMode}
          buttonLabel="Send Query"
        />
      </div>
    </div>
  );
}

export function AuditFindingsTab({
  companyId,
  engagementId,
  findings,
  periodStart,
  periodEnd,
  materialityThreshold,
  financialYearStartDate,
  previewMode,
}: {
  companyId: string;
  engagementId: number | null;
  findings: AuditFinding[];
  periodStart: string;
  periodEnd: string;
  materialityThreshold: number;
  financialYearStartDate: string;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<AuditFindingCategory>("Test");
  const [running, setRunning] = useState<"tests" | "intelligence" | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function runTests() {
    setRunning("tests");
    try {
      await fetch(`/api/companies/${companyId}/audit/findings/run-tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId, periodStart, periodEnd, materialityThreshold }),
      });
      router.refresh();
    } finally {
      setRunning(null);
    }
  }

  async function runIntelligence() {
    setRunning("intelligence");
    try {
      await fetch(`/api/companies/${companyId}/audit/findings/run-intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId, periodStart, periodEnd, financialYearStartDate }),
      });
      router.refresh();
    } finally {
      setRunning(null);
    }
  }

  const filtered = findings.filter((f) => f.category === category);
  const open = filtered.filter((f) => f.status === "Open");
  const resolved = filtered.filter((f) => f.status !== "Open");

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-full border border-vf-paper-border p-1">
            {(["Test", "Intelligence"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${category === c ? "bg-vf-red-500/10 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft"}`}
              >
                {c === "Test" ? "Audit Tests (18)" : "Audit Intelligence"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="subtle" size="sm" disabled={previewMode || running !== null} title={disabledTitle} onClick={runTests}>
              <IconRefresh className="h-4 w-4" /> {running === "tests" ? "Running…" : "Run Audit Tests"}
            </Button>
            <Button variant="subtle" size="sm" disabled={previewMode || running !== null} title={disabledTitle} onClick={runIntelligence}>
              <IconRefresh className="h-4 w-4" /> {running === "intelligence" ? "Running…" : "Run Audit Intelligence"}
            </Button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title={`No ${category === "Test" ? "Audit Test" : "Audit Intelligence"} findings.`} description="Run it above to scan the current period." />
        ) : (
          <>
            <div>
              <h2 className="mb-3 text-sm font-semibold text-vf-ink">Open ({open.length})</h2>
              {open.length === 0 ? (
                <p className="text-sm text-vf-ink-faint">Nothing awaiting review.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {open.map((f) => (
                    <FindingCard key={f.id} finding={f} companyId={companyId} previewMode={previewMode} />
                  ))}
                </div>
              )}
            </div>
            {resolved.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-vf-ink">Review History ({resolved.length})</h2>
                <div className="flex flex-col gap-3">
                  {resolved.map((f) => (
                    <FindingCard key={f.id} finding={f} companyId={companyId} previewMode={previewMode} />
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
