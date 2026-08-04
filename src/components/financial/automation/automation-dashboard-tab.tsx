"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconRefresh } from "@/components/ui/icons";
import type { AutomationTask } from "@/server/automation/types";
import type { AutomationAuditLogEntry } from "@/server/automation/types";

const STATUS_TONE: Record<string, "good" | "warn" | "danger" | "muted" | "info"> = {
  Queued: "info", Running: "info", Success: "good", Failed: "danger", Paused: "muted", Disabled: "muted",
};

function TaskRow({ task, companyId, previewMode }: { task: AutomationTask; companyId: string; previewMode: boolean }) {
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
      <TableCell><Badge tone={STATUS_TONE[task.status] ?? "muted"}>{task.status}</Badge></TableCell>
      <TableCell>{new Date(task.nextRunAt).toLocaleString()}</TableCell>
      <TableCell>{task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : "Never"}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{task.retryCount}/{task.maxRetries}</TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => act("run-now")}>Run Now</Button>
          {task.status === "Paused" ? (
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
  auditLog,
  previewMode,
}: {
  companyId: string;
  tasks: AutomationTask[];
  auditLog: AutomationAuditLogEntry[];
  previewMode: boolean;
}) {
  const router = useRouter();
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
                  <TaskRow key={t.id} task={t} companyId={companyId} previewMode={previewMode} />
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
                  {e.durationMs !== null && ` · ${e.durationMs}ms`} · by {e.performedBy} · {new Date(e.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
