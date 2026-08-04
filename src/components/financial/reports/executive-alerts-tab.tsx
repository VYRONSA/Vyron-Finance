"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { IconMinus, IconRefresh, IconShieldCheck } from "@/components/ui/icons";
import type { ExecutiveAlert, ExecutiveAlertPriority } from "@/server/reporting/types";

const PRIORITY_TONE: Record<ExecutiveAlertPriority, "info" | "warn" | "danger"> = { Low: "info", Medium: "info", High: "warn", Critical: "danger" };
const ALERT_LABEL: Record<ExecutiveAlert["alertType"], string> = {
  DecliningCash: "Declining Cash",
  IncreasingDebtors: "Increasing Debtors",
  SlowPayingCustomers: "Slow-Paying Customers",
  SupplierRisk: "Supplier Risk",
  MarginReduction: "Margin Reduction",
  InventoryProblems: "Inventory Problems",
  ComplianceIssues: "Compliance Issues",
  AutomationFailures: "Automation Failures",
  LargeUnusualTransactions: "Large / Unusual Transactions",
  DuplicateTrends: "Duplicate Trends",
};

function AlertCard({ alert, companyId, previewMode }: { alert: ExecutiveAlert; companyId: string; previewMode: boolean }) {
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
      const res = await fetch(`/api/companies/${companyId}/executive-alerts/${alert.id}`, {
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
            <Badge tone={PRIORITY_TONE[alert.priority]}>{alert.priority}</Badge>
            <span className="text-xs font-medium text-vf-ink-faint">{ALERT_LABEL[alert.alertType]}</span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-vf-ink">{alert.reason}</p>
        </div>
        {alert.status === "Open" && (
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
          <dd className="text-vf-ink-soft">{alert.evidence || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-vf-ink-faint">Recommended Action</dt>
          <dd className="text-vf-ink-soft">{alert.recommendedAction || "—"}</dd>
        </div>
      </dl>

      {alert.status !== "Open" && (
        <p className="mt-2 text-xs text-vf-ink-faint">
          {alert.status} by {alert.resolvedBy} {alert.resolvedAt ? `on ${new Date(alert.resolvedAt).toLocaleString()}` : ""}
          {alert.resolutionNote && ` — "${alert.resolutionNote}"`}
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

export function ExecutiveAlertsTab({ companyId, alerts, previewMode }: { companyId: string; alerts: ExecutiveAlert[]; previewMode: boolean }) {
  const router = useRouter();
  const [runningDetection, setRunningDetection] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function runDetection() {
    setRunningDetection(true);
    try {
      await fetch(`/api/companies/${companyId}/executive-alerts/run-detection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      router.refresh();
    } finally {
      setRunningDetection(false);
    }
  }

  const open = alerts.filter((a) => a.status === "Open");
  const resolved = alerts.filter((a) => a.status !== "Open");

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 pt-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-vf-ink-faint">Scans Cashflow/Revenue trends, VAT/Banking Exceptions, Inventory, and Automation Task health for real threshold breaches.</p>
          <Button variant="subtle" size="sm" disabled={previewMode || runningDetection} title={disabledTitle} onClick={runDetection}>
            <IconRefresh className="h-4 w-4" /> Run Detection Now
          </Button>
        </div>

        {alerts.length === 0 ? (
          <EmptyState title="No executive alerts." description="Run Detection Now to scan for real threshold breaches across the platform." />
        ) : (
          <>
            <div>
              <h2 className="mb-3 text-sm font-semibold text-vf-ink">Open ({open.length})</h2>
              {open.length === 0 ? (
                <p className="text-sm text-vf-ink-faint">Nothing awaiting review.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {open.map((a) => (
                    <AlertCard key={a.id} alert={a} companyId={companyId} previewMode={previewMode} />
                  ))}
                </div>
              )}
            </div>
            {resolved.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-vf-ink">Resolution History ({resolved.length})</h2>
                <div className="flex flex-col gap-3">
                  {resolved.map((a) => (
                    <AlertCard key={a.id} alert={a} companyId={companyId} previewMode={previewMode} />
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
