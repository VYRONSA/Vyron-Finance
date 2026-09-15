"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconRefresh } from "@/components/ui/icons";
import type { AutomationTask, AutomationTaskRun } from "@/server/automation/types";
import type { AutomationAuditLogEntry } from "@/server/automation/types";
import { categorizeAiSweepRun } from "@/server/services/automation-dashboard-summary-service";
import { formatDateTime } from "@/lib/format";

const STATUS_TONE: Record<string, "good" | "warn" | "danger" | "muted" | "info"> = {
  Queued: "info", Running: "info", Success: "good", Failed: "danger", Paused: "muted", Disabled: "muted", Suspended: "danger",
};

/** Phase 29C — "Success" alone previously meant three different things
 * for an AI Classification Sweep: real progress, nothing eligible to
 * process, or a fully rate-limited run — all rendered as the same green
 * badge. Only overrides the label/tone for that ONE task type when a
 * `lastRun` is actually available to categorize; every other task type,
 * and a sweep with no run history yet, keep the exact original
 * `STATUS_TONE` mapping — this never changes what "Failed"/"Queued"/
 * "Paused"/"Disabled" mean. */
function taskBadge(task: AutomationTask, lastRun: AutomationTaskRun | undefined): { label: string; tone: "good" | "warn" | "danger" | "muted" | "info" } {
  if (task.status === "Success" && task.taskType === "AiClassificationSweep" && lastRun) {
    const category = categorizeAiSweepRun(lastRun.summary);
    if (category === "no-eligible") return { label: "No eligible transactions", tone: "muted" };
    if (category === "rate-limited") return { label: "Rate limited", tone: "warn" };
    if (category === "no-confident-suggestion") return { label: "No confident suggestions", tone: "info" };
    if (category === "provider-unavailable") return { label: "AI provider unavailable", tone: "danger" };
    if (category === "daily-cap") return { label: "Daily AI safety cap reached", tone: "warn" };
  }
  return { label: task.status, tone: STATUS_TONE[task.status] ?? "muted" };
}

/** Phase 26G — the exact gap that made "AiClassificationSweep — Success"
 * indistinguishable from "AiClassificationSweep — Success, but genuinely
 * classified zero transactions": `finishTaskRun` has always stored a
 * real, detailed summary (`{attempted, classified, autoAllocated,
 * noConfidentSuggestion, failed, rateLimited, hasMoreEligible}` for this
 * task type — see `scheduler-service.ts::runTask`) in `automation_task_runs.summary`,
 * and the page hosting this tab has always fetched those rows
 * (`runsToday`) — but nothing ever rendered them. A "Success" badge
 * alone cannot tell an operator "the scheduler ran" apart from "the
 * scheduler ran AND actually did something," which is precisely the
 * confusion this phase's own investigation traced back to. Renders
 * whatever key/value pairs the task type's own summary happens to
 * contain — deliberately generic, not type-type-specific, so every
 * current and future task type's summary becomes visible here for free. */
function summaryText(summary: Record<string, unknown>): string | null {
  const entries = Object.entries(summary).filter(([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean");
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}

function TaskRow({ task, companyId, previewMode, lastRun }: { task: AutomationTask; companyId: string; previewMode: boolean; lastRun: AutomationTaskRun | undefined }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function act(action: string) {
    setLoading(true);
    try {
      await fetch(`/api/companies/${companyId}/automation-tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium text-vf-ink">{task.name}</TableCell>
      <TableCell>{task.taskType}</TableCell>
      <TableCell>
        {(() => {
          const badge = taskBadge(task, lastRun);
          return <Badge tone={badge.tone}>{badge.label}</Badge>;
        })()}
      </TableCell>
      <TableCell>{formatDateTime(task.nextRunAt)}</TableCell>
      <TableCell>
        {task.lastRunAt ? formatDateTime(task.lastRunAt) : "Never"}
        {lastRun && summaryText(lastRun.summary) && (
          <p className="mt-0.5 text-xs text-vf-ink-faint" title="What the last run actually did — not just whether it succeeded">
            {summaryText(lastRun.summary)}
          </p>
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{task.retryCount}/{task.maxRetries}</TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act("run-now")}>Run Now</Button>
          {task.status === "Paused" || task.status === "Suspended" ? (
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act("resume")}>Resume</Button>
          ) : (
            <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act("pause")}>Pause</Button>
          )}
          <Button variant="subtle" size="sm" disabled={previewMode || loading || task.status === "Disabled"} title={disabledTitle} onClick={() => act("disable")}>Disable</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function AutomationDashboardTab({
  companyId,
  tasks,
  recentRuns,
  auditLog,
  previewMode,
}: {
  companyId: string;
  tasks: AutomationTask[];
  /** Phase 26G — today's task runs, already fetched by the hosting page
   * for the aggregate summary bar above; only the per-task LATEST run is
   * used here, keyed by `taskId`. Optional, defaulting to none, so any
   * other caller of this component (none currently exist, but this
   * keeps the prop additive) doesn't need to change. */
  recentRuns?: AutomationTaskRun[];
  auditLog: AutomationAuditLogEntry[];
  previewMode: boolean;
}) {
  const router = useRouter();
  const lastRunByTaskId = new Map<number, AutomationTaskRun>();
  for (const run of recentRuns ?? []) {
    const existing = lastRunByTaskId.get(run.taskId);
    if (!existing || run.startedAt > existing.startedAt) lastRunByTaskId.set(run.taskId, run);
  }
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<{ processed: number; succeeded: number; failed: number } | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function runSchedulerNow() {
    setRunning(true);
    setOutcome(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/automation-tasks`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setOutcome(data.outcome);
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={previewMode || running} title={disabledTitle} onClick={runSchedulerNow}>
          <IconRefresh className="h-4 w-4" /> {running ? "Running…" : "Run Scheduler Now"}
        </Button>
        {outcome && (
          <span className="text-sm text-vf-ink-soft">
            Processed {outcome.processed} task(s) — {outcome.succeeded} succeeded, {outcome.failed} failed.
          </span>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scheduler Queue</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {tasks.length === 0 ? (
            <EmptyState title="No automation tasks yet." description="Tasks are created automatically for every active Recurring Template and periodic Rule Engine run." />
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeadCell>Task</TableHeadCell>
                  <TableHeadCell>Type</TableHeadCell>
                  <TableHeadCell>Status</TableHeadCell>
                  <TableHeadCell>Next Run</TableHeadCell>
                  <TableHeadCell>Last Run</TableHeadCell>
                  <TableHeadCell className="text-right">Retries</TableHeadCell>
                  <TableHeadCell className="text-right">Actions</TableHeadCell>
                </tr>
              </TableHead>
              <TableBody>
                {tasks.map((t) => (
                  <TaskRow key={t.id} task={t} companyId={companyId} previewMode={previewMode} lastRun={lastRunByTaskId.get(t.id)} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automation Audit Trail</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {auditLog.length === 0 ? (
            <EmptyState title="No automated actions recorded yet." description="Every automated generation or rule application is logged here." />
          ) : (
            <ul className="flex flex-col gap-2 text-xs text-vf-ink-soft">
              {auditLog.map((e) => (
                <li key={e.id} className="border-t border-vf-paper-border pt-2 first:border-0 first:pt-0">
                  <span className="font-medium text-vf-ink">{e.actionType}</span> — {e.reason || "No reason recorded."}
                  {e.documentType && ` · ${e.documentType} #${e.documentId}`}
                  {e.journalIds.length > 0 && ` · Journal(s) ${e.journalIds.join(", ")}`}
                  {e.durationMs !== null && ` · ${e.durationMs}ms`} · by {e.performedBy} · {formatDateTime(e.createdAt)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
