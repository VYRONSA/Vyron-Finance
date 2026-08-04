"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAlertTriangle, IconShieldCheck } from "@/components/ui/icons";
import { MetricValue } from "./metric-value";
import type { CompanyOperationsSnapshot } from "@/server/services/operations-service";
import type { AlertStatus, EngineStatus, EventSeverity } from "@/server/operations/types";

const TABS = [
  "Platform Health", "Engine Health", "Background Processing", "Integration Health", "Communication Health",
  "Security", "Performance", "Audit", "Alert Centre", "Tenant Health",
] as const;
type Tab = (typeof TABS)[number];

const ENGINE_STATUS_TONE: Record<EngineStatus, "good" | "warn" | "danger" | "muted"> = {
  Healthy: "good", Degraded: "warn", Failing: "danger", NotInstrumented: "muted",
};

const SEVERITY_TONE: Record<EventSeverity, "info" | "warn" | "danger"> = {
  info: "info", warning: "warn", high: "danger", critical: "danger",
};

const ALERT_STATUS_TONE: Record<AlertStatus, "muted" | "info" | "good" | "warn"> = {
  Open: "warn", Acknowledged: "info", Assigned: "info", Resolved: "good", Reopened: "warn",
};

function PlatformHealthTab({ snapshots }: { snapshots: CompanyOperationsSnapshot[] }) {
  const totalOpenAlerts = snapshots.reduce((sum, s) => sum + s.alerts.filter((a) => a.status === "Open").length, 0);
  const totalFailedJobs = snapshots.reduce((sum, s) => sum + s.backgroundJobs.failed, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <StatTile value={String(snapshots.length)} label="Active Companies" />
        <StatTile value="Not Available" label="Active Users" />
        <StatTile value="Not Available" label="Active Sessions" />
        <StatTile value="Reachable" label="API Availability" />
        <StatTile value={String(totalOpenAlerts)} label="Open Alerts" />
        <StatTile value={String(totalFailedJobs)} label="Failed Background Jobs" />
      </div>
      <p className="text-xs text-vf-ink-faint">
        Active Users/Active Sessions have no instrumentation anywhere in this codebase yet (no session-tracking table
        exists) — honestly Not Available rather than a fabricated count. “API Availability” reflects only that this
        request reached the app; it is not a measured uptime percentage.
      </p>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Database / Storage / Scheduler Status</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-vf-sm border border-vf-paper-border p-3 text-sm">
            <p className="font-medium text-vf-ink">Database</p>
            <p className="mt-1 text-xs text-vf-ink-faint">Reachable — every section on this page just queried it successfully.</p>
          </div>
          <div className="rounded-vf-sm border border-vf-paper-border p-3 text-sm">
            <p className="font-medium text-vf-ink">Storage</p>
            <p className="mt-1 text-xs text-vf-ink-faint">No storage health probe exists yet — see the Document Platform’s own bucket for real usage.</p>
          </div>
          <div className="rounded-vf-sm border border-vf-paper-border p-3 text-sm">
            <p className="font-medium text-vf-ink">Scheduler</p>
            <p className="mt-1 text-xs text-vf-ink-faint">See the Engine Health tab’s “Automation Scheduler” row for live queue depth and recent runs.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EngineHealthTab({ snapshot }: { snapshot: CompanyOperationsSnapshot }) {
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Engine</TableHeadCell>
          <TableHeadCell>Status</TableHeadCell>
          <TableHeadCell>Queue Depth</TableHeadCell>
          <TableHeadCell>Last Execution</TableHeadCell>
          <TableHeadCell>Errors</TableHeadCell>
          <TableHeadCell>Avg. Duration</TableHeadCell>
          <TableHeadCell>Last Successful Run</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {snapshot.engineHealth.map((e) => (
          <TableRow key={e.name}>
            <TableCell className="font-medium text-vf-ink">{e.name}</TableCell>
            <TableCell><Badge tone={ENGINE_STATUS_TONE[e.status]}>{e.status}</Badge></TableCell>
            <TableCell><MetricValue metric={e.queueDepth} /></TableCell>
            <TableCell><MetricValue metric={e.lastExecutionAt} format={(v) => new Date(v as string).toLocaleString()} /></TableCell>
            <TableCell><MetricValue metric={e.errorCount} /></TableCell>
            <TableCell><MetricValue metric={e.avgExecutionTimeMs} format={(v) => `${v}ms`} /></TableCell>
            <TableCell><MetricValue metric={e.lastSuccessfulRunAt} format={(v) => new Date(v as string).toLocaleString()} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BackgroundProcessingTab({ snapshot }: { snapshot: CompanyOperationsSnapshot }) {
  const { backgroundJobs } = snapshot;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile value={String(backgroundJobs.waiting)} label="Jobs Waiting" />
        <StatTile value={String(backgroundJobs.running)} label="Jobs Running" />
        <StatTile value={String(backgroundJobs.failed)} label="Jobs Failed" />
        <StatTile value={String(backgroundJobs.retrying)} label="Retry Queue" />
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Long-Running Jobs (10+ min)</p>
        {backgroundJobs.longRunning.length === 0 ? <p className="text-sm text-vf-ink-faint">None.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {backgroundJobs.longRunning.map((r) => <li key={r.id}>Run #{r.id} — started {new Date(r.startedAt).toLocaleString()}</li>)}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Stuck Jobs (30+ min, likely needs manual retry)</p>
        {backgroundJobs.stuckJobs.length === 0 ? <p className="text-sm text-vf-ink-faint">None.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {backgroundJobs.stuckJobs.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-vf-sm border border-vf-paper-border px-3 py-2">
                <span>Run #{r.id} — started {new Date(r.startedAt).toLocaleString()}</span>
                <span className="text-xs text-vf-ink-faint">Retry from Recurring Templates / Automation Dashboard’s own “Run Now” action</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function IntegrationHealthTab({ snapshot }: { snapshot: CompanyOperationsSnapshot }) {
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Integration</TableHeadCell>
          <TableHeadCell>Status</TableHeadCell>
          <TableHeadCell>Last Sync</TableHeadCell>
          <TableHeadCell>Last Error</TableHeadCell>
          <TableHeadCell>Next Scheduled Sync</TableHeadCell>
          <TableHeadCell>Retry Count</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {snapshot.integrationHealth.map((i) => (
          <TableRow key={i.name}>
            <TableCell className="font-medium text-vf-ink">{i.name}</TableCell>
            <TableCell><Badge tone={i.status === "Connected" ? "good" : i.status === "Error" ? "danger" : "muted"}>{i.status}</Badge></TableCell>
            <TableCell><MetricValue metric={i.lastSync} /></TableCell>
            <TableCell><MetricValue metric={i.lastError} /></TableCell>
            <TableCell><MetricValue metric={i.nextScheduledSync} /></TableCell>
            <TableCell><MetricValue metric={i.retryCount} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CommunicationHealthTab({ snapshot }: { snapshot: CompanyOperationsSnapshot }) {
  const c = snapshot.communicationHealth;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <StatTile value={String(c.queued)} label="Queued" />
        <StatTile value={String(c.scheduled)} label="Scheduled" />
        <StatTile value={String(c.sent)} label="Sent" />
        <StatTile value={String(c.retrying)} label="Retrying" />
        <StatTile value={String(c.failed)} label="Failed" />
        <StatTile value={String(c.awaitingApproval)} label="Awaiting Approval" />
        <StatTile value={c.averageDeliverySeconds !== null ? `${c.averageDeliverySeconds.toFixed(1)}s` : "—"} label="Avg. Delivery Time" />
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Failure Reasons</p>
        {c.topFailureReasons.length === 0 ? <p className="text-sm text-vf-ink-faint">None recorded.</p> : (
          <ul className="flex flex-col gap-1.5">
            {c.topFailureReasons.map((f) => (
              <li key={f.reason} className="flex items-center justify-between rounded-vf-sm border border-vf-paper-border px-3 py-2 text-sm">
                <span className="text-vf-ink-soft">{f.reason}</span>
                <span className="font-mono tabular-nums text-vf-ink-faint">{f.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SecurityTab({ snapshot }: { snapshot: CompanyOperationsSnapshot }) {
  const s = snapshot.security;
  const metrics: [string, { count: number; tracked: boolean }][] = [
    ["Failed Logins", s.failedLogins], ["Permission Denials", s.permissionDenials], ["Suspicious Activity", s.suspiciousActivity],
    ["Locked Accounts", s.lockedAccounts], ["Expired Sessions", s.expiredSessions], ["API Auth Failures", s.apiAuthFailures],
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map(([label, m]) => (
          <div key={label} className="flex flex-col">
            {m.tracked ? (
              <div className="font-mono text-2xl font-semibold tabular-nums text-vf-red-600">{m.count}</div>
            ) : (
              <Badge tone="muted">Not Available</Badge>
            )}
            <div className="mt-1 text-xs text-vf-ink-faint">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-vf-ink-faint">
        Only Permission Denials are instrumented today (logged from the one shared `requirePermission()`/`requireApproval()`
        check every route in the platform already funnels through). The others show “Not Available” honestly rather than a
        fabricated zero that would look identical to “tracked, none occurred.”
      </p>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Recent Events</p>
        {s.recentEvents.length === 0 ? (
          <EmptyState icon={<IconShieldCheck className="h-5 w-5" />} title="No security events recorded" description="Permission denials and other tracked security events will appear here." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {s.recentEvents.map((e) => (
              <li key={e.id} className="rounded-vf-sm border border-vf-paper-border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity}</Badge>
                  <span className="font-medium text-vf-ink">{e.eventType}</span>
                  <span className="text-xs text-vf-ink-faint">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-xs text-vf-ink-faint">{e.actor ?? "Unknown actor"} — {e.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PerformanceTab({ snapshot }: { snapshot: CompanyOperationsSnapshot }) {
  const p = snapshot.performance;
  const infraMetrics: [string, { note?: string }][] = [
    ["Slowest Queries", p.slowestQueries], ["Slowest Pages", p.slowestPages], ["Slowest Reports", p.slowestReports],
    ["Slowest APIs", p.slowestApis], ["Largest Datasets", p.largestDatasets], ["Memory Usage", p.memoryUsage], ["CPU Usage", p.cpuUsage],
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Scheduler Task Duration (Scheduler / Rule Engine / Communication Queue)</p>
        {p.schedulerTaskDurations.length === 0 ? <p className="text-sm text-vf-ink-faint">No scheduled runs in the observed window.</p> : (
          <Table>
            <TableHead><tr><TableHeadCell>Task Type</TableHeadCell><TableHeadCell>Avg. Duration</TableHeadCell><TableHeadCell>Last Duration</TableHeadCell><TableHeadCell>Sample Count</TableHeadCell></tr></TableHead>
            <TableBody>
              {p.schedulerTaskDurations.map((d) => (
                <TableRow key={d.taskType}>
                  <TableCell className="font-medium text-vf-ink">{d.taskType}</TableCell>
                  <TableCell>{d.avgDurationMs !== null ? `${d.avgDurationMs}ms` : "—"}</TableCell>
                  <TableCell>{d.lastDurationMs !== null ? `${d.lastDurationMs}ms` : "—"}</TableCell>
                  <TableCell>{d.sampleCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Infrastructure Metrics</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {infraMetrics.map(([label, m]) => (
            <div key={label} className="rounded-vf-sm border border-vf-paper-border p-3 text-sm">
              <p className="font-medium text-vf-ink">{label}</p>
              <p className="mt-1 text-xs text-vf-ink-faint">{m.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuditTab({ snapshot }: { snapshot: CompanyOperationsSnapshot }) {
  const a = snapshot.audit;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatTile value={String(a.totalAutomationEntries)} label="Audit Log Volume" />
        <StatTile value={String(a.journalReversalCount)} label="Journal Reversals" />
        <StatTile value={String(a.permissionChangeCount)} label="Permission Changes" />
        <StatTile value={String(a.workflowOverrideCount)} label="Workflow Overrides" />
        <StatTile value={String(a.manualMatchingOverrideCount)} label="Manual Matching Overrides" />
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Recent Critical (Non-Reversible) Events</p>
        {a.recentCriticalEntries.length === 0 ? <p className="text-sm text-vf-ink-faint">None.</p> : (
          <ul className="flex flex-col gap-1.5">
            {a.recentCriticalEntries.map((e) => (
              <li key={e.id} className="rounded-vf-sm border border-vf-paper-border p-3 text-sm">
                <span className="font-medium text-vf-ink">{e.actionType}</span> — {e.performedBy} — <span className="text-xs text-vf-ink-faint">{new Date(e.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Recent Permission Changes</p>
        {a.recentPermissionChanges.length === 0 ? <p className="text-sm text-vf-ink-faint">None.</p> : (
          <ul className="flex flex-col gap-1.5">
            {a.recentPermissionChanges.map((e) => (
              <li key={e.id} className="rounded-vf-sm border border-vf-paper-border p-3 text-sm">
                <span className="font-medium text-vf-ink">{e.itemType}#{e.itemId}</span>.{e.fieldName}: {e.oldValue ?? "—"} → {e.newValue ?? "—"} — {e.performedBy}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AlertCentreTab({ companyId, snapshot, previewMode }: { companyId: string; snapshot: CompanyOperationsSnapshot; previewMode: boolean }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function act(id: number, action: "acknowledge" | "resolve" | "reopen") {
    setLoadingId(id);
    try {
      await fetch(`/api/companies/${companyId}/operations/alerts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      router.refresh();
    } finally {
      setLoadingId(null);
    }
  }

  if (snapshot.alerts.length === 0) {
    return <EmptyState icon={<IconAlertTriangle className="h-5 w-5" />} title="No alerts" description="Alerts raised by any engine (retry-exhausted automation, failed communications, ...) will appear here." />;
  }

  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Severity</TableHeadCell><TableHeadCell>Source</TableHeadCell><TableHeadCell>Title</TableHeadCell>
          <TableHeadCell>Status</TableHeadCell><TableHeadCell>Raised</TableHeadCell><TableHeadCell className="text-right"><span className="sr-only">Actions</span></TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {snapshot.alerts.map((a) => (
          <TableRow key={a.id}>
            <TableCell><Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge></TableCell>
            <TableCell>{a.sourceEngine}</TableCell>
            <TableCell className="max-w-[32ch]">{a.title}</TableCell>
            <TableCell><Badge tone={ALERT_STATUS_TONE[a.status]}>{a.status}</Badge></TableCell>
            <TableCell className="text-xs text-vf-ink-faint">{new Date(a.createdAt).toLocaleString()}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1.5">
                {a.status === "Open" && <Button variant="subtle" size="sm" disabled={previewMode || loadingId === a.id} title={disabledTitle} onClick={() => act(a.id, "acknowledge")}>Acknowledge</Button>}
                {a.status !== "Resolved" && <Button variant="subtle" size="sm" disabled={previewMode || loadingId === a.id} title={disabledTitle} onClick={() => act(a.id, "resolve")}>Resolve</Button>}
                {a.status === "Resolved" && <Button variant="subtle" size="sm" disabled={previewMode || loadingId === a.id} title={disabledTitle} onClick={() => act(a.id, "reopen")}>Reopen</Button>}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TenantHealthTab({ snapshots }: { snapshots: CompanyOperationsSnapshot[] }) {
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Company</TableHeadCell><TableHeadCell>Reporting Readiness</TableHeadCell><TableHeadCell>VAT Readiness</TableHeadCell>
          <TableHeadCell>Audit Readiness</TableHeadCell><TableHeadCell>Automation Health</TableHeadCell><TableHeadCell>Outstanding Errors</TableHeadCell><TableHeadCell>Last Backup</TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        {snapshots.map((s) => (
          <TableRow key={s.companyId}>
            <TableCell className="font-medium text-vf-ink">{s.tenantHealth.companyName}</TableCell>
            <TableCell><MetricValue metric={s.tenantHealth.reportingReadiness} /></TableCell>
            <TableCell><MetricValue metric={s.tenantHealth.vatReadiness} /></TableCell>
            <TableCell><MetricValue metric={s.tenantHealth.auditReadiness} /></TableCell>
            <TableCell><MetricValue metric={s.tenantHealth.automationHealth} /></TableCell>
            <TableCell><MetricValue metric={s.tenantHealth.outstandingErrors} /></TableCell>
            <TableCell><MetricValue metric={s.tenantHealth.lastBackup} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function OperationsTabs({ snapshots, previewMode }: { snapshots: CompanyOperationsSnapshot[]; previewMode: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>("Platform Health");
  const [selectedCompanyId, setSelectedCompanyId] = useState(snapshots[0].companyId);
  const selected = snapshots.find((s) => s.companyId === selectedCompanyId) ?? snapshots[0];

  const needsCompanySelector = !["Platform Health", "Tenant Health"].includes(activeTab);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-vf-paper-border px-4 pt-3">
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? "page" : undefined}
              className={cn(
                "rounded-t-lg px-3 py-2 text-sm font-medium transition",
                activeTab === tab ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        {needsCompanySelector && snapshots.length > 1 && (
          <div className="w-56 pb-2">
            <Select aria-label="Company" value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)}>
              {snapshots.map((s) => <option key={s.companyId} value={s.companyId}>{s.companyName}</option>)}
            </Select>
          </div>
        )}
      </div>
      <CardContent className="pt-5">
        {activeTab === "Platform Health" && <PlatformHealthTab snapshots={snapshots} />}
        {activeTab === "Engine Health" && <EngineHealthTab snapshot={selected} />}
        {activeTab === "Background Processing" && <BackgroundProcessingTab snapshot={selected} />}
        {activeTab === "Integration Health" && <IntegrationHealthTab snapshot={selected} />}
        {activeTab === "Communication Health" && <CommunicationHealthTab snapshot={selected} />}
        {activeTab === "Security" && <SecurityTab snapshot={selected} />}
        {activeTab === "Performance" && <PerformanceTab snapshot={selected} />}
        {activeTab === "Audit" && <AuditTab snapshot={selected} />}
        {activeTab === "Alert Centre" && <AlertCentreTab companyId={selected.companyId} snapshot={selected} previewMode={previewMode} />}
        {activeTab === "Tenant Health" && <TenantHealthTab snapshots={snapshots} />}
      </CardContent>
    </Card>
  );
}
