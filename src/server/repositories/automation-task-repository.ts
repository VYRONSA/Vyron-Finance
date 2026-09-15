/**
 * Repository layer for the Automation Scheduler's own queue — the ONE
 * shared table every scheduled activity in the platform executes
 * through. See `scheduler-service.ts` for the orchestration on top.
 */

import { createClient } from "@/lib/supabase/server";
import {
  automationTaskFromRow,
  automationTaskRunFromRow,
  type AutomationTaskRow,
  type AutomationTaskRunRow,
} from "@/server/automation/mappers";
import type { AutomationTask, AutomationTaskRun, AutomationTaskStatus, AutomationTaskType } from "@/server/automation/types";

// RC1 Phase 7 — a generous cap, not a real-world limit: no company has
// anywhere near this many automation tasks/runs today, this only guards
// against pathological unbounded growth, matching the LIST_CAP
// convention already established elsewhere (customer-repository.ts etc).
const LIST_CAP = 10_000;

export async function listAutomationTasks(companyId: string): Promise<AutomationTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_tasks")
    .select("*")
    .eq("company_id", companyId)
    .order("next_run_at")
    .limit(LIST_CAP)
    .returns<AutomationTaskRow[]>();
  if (error) throw error;
  return data.map(automationTaskFromRow);
}

export async function getAutomationTask(companyId: string, taskId: number): Promise<AutomationTask | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_tasks")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", taskId)
    .maybeSingle<AutomationTaskRow>();
  if (error) throw error;
  return data ? automationTaskFromRow(data) : null;
}

/** Every task due to run right now — `is_active` AND not already
 * Paused/Disabled AND `next_run_at` has arrived. The Scheduler's own
 * worklist, shared by every task type (recurring templates, periodic
 * Rule Engine runs, future scheduled work). */
export async function listDueTasks(companyId: string, nowIso: string): Promise<AutomationTask[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_tasks")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .in("status", ["Queued", "Success", "Failed"])
    .lte("next_run_at", nowIso)
    .order("next_run_at")
    .limit(LIST_CAP)
    .returns<AutomationTaskRow[]>();
  if (error) throw error;
  return data.map(automationTaskFromRow);
}

export type NewAutomationTask = {
  taskType: AutomationTaskType;
  referenceId?: number | null;
  name: string;
  nextRunAt: string;
  maxRetries?: number;
};

export async function createAutomationTask(companyId: string, input: NewAutomationTask): Promise<AutomationTask> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_tasks")
    .insert({
      company_id: companyId,
      task_type: input.taskType,
      reference_id: input.referenceId ?? null,
      name: input.name,
      next_run_at: input.nextRunAt,
      max_retries: input.maxRetries ?? 3,
    })
    .select("*")
    .single<AutomationTaskRow>();
  if (error) throw error;
  return automationTaskFromRow(data);
}

export async function setTaskStatus(companyId: string, taskId: number, status: AutomationTaskStatus, isActive?: boolean): Promise<void> {
  const supabase = await createClient();
  const update: Record<string, unknown> = { status };
  if (isActive !== undefined) update.is_active = isActive;
  const { error } = await supabase.from("automation_tasks").update(update).eq("company_id", companyId).eq("id", taskId);
  if (error) throw error;
}

/** Migration 0099 — the scheduler has exhausted this task's retries:
 * stop it (`listDueTasks` never selects `Suspended` or inactive tasks) and
 * record why. Only an explicit Resume makes it runnable again. */
export async function suspendTask(companyId: string, taskId: number, reason: string, suspendedAtIso: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("automation_tasks")
    .update({ status: "Suspended", is_active: false, suspended_reason: reason.slice(0, 1000), suspended_at: suspendedAtIso })
    .eq("company_id", companyId)
    .eq("id", taskId);
  if (error) throw error;
}

/** A person resumes a Paused/Suspended/Disabled task: runnable again, with
 * a fresh retry budget and the suspension cleared. */
export async function resumeAutomationTask(companyId: string, taskId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("automation_tasks")
    .update({ status: "Queued", is_active: true, retry_count: 0, suspended_reason: null, suspended_at: null })
    .eq("company_id", companyId)
    .eq("id", taskId);
  if (error) throw error;
}

/** Atomic conditional claim, same pattern as
 * `transaction-explorer-repository.ts::applyAiClassification` and
 * `communication-repository.ts::claimCommunicationForSending` — the
 * only condition is "not already Running" (deliberately NOT the full
 * `listDueTasks` eligibility filter: `runTaskNow`'s manual trigger is
 * allowed to run a Paused/Disabled task on demand today, and this claim
 * must not silently take that away — it exists only to stop the SAME
 * task being started twice at once, whether that's two overlapping
 * scheduler passes or a "Run Now" racing the scheduler). Two callers
 * racing to start the same task both see it eligible, but only ONE
 * `UPDATE` actually flips it to `Running` — the loser's update touches
 * zero rows and `.maybeSingle()` returns null, which callers treat as
 * "already running elsewhere" rather than executing it a second time. */
export async function claimTaskForRunning(companyId: string, taskId: number): Promise<AutomationTask | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_tasks")
    .update({ status: "Running" })
    .eq("company_id", companyId)
    .eq("id", taskId)
    .neq("status", "Running")
    .select("*")
    .maybeSingle<AutomationTaskRow>();
  if (error) throw error;
  return data ? automationTaskFromRow(data) : null;
}

/** Pushes a due task's `next_run_at` forward without starting a run or
 * touching retry/last-run bookkeeping — for a task that was due but
 * deliberately not executed this pass (e.g. the Commercial Billing
 * Platform's `checkUsageLimit(companyId, "max_automation_runs_monthly")`
 * gate in `scheduler-service.ts::runDueTasks`), as opposed to one that
 * ran and failed. */
export async function deferTask(companyId: string, taskId: number, nextRunAt: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("automation_tasks").update({ next_run_at: nextRunAt }).eq("company_id", companyId).eq("id", taskId);
  if (error) throw error;
}

export async function recordTaskOutcome(
  companyId: string,
  taskId: number,
  fields: { status: AutomationTaskStatus; nextRunAt: string; lastRunAt: string; lastRunStatus: string; lastRunDurationMs: number; retryCount: number },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("automation_tasks")
    .update({
      status: fields.status,
      next_run_at: fields.nextRunAt,
      last_run_at: fields.lastRunAt,
      last_run_status: fields.lastRunStatus,
      last_run_duration_ms: fields.lastRunDurationMs,
      retry_count: fields.retryCount,
    })
    .eq("company_id", companyId)
    .eq("id", taskId);
  if (error) throw error;
}

export async function startTaskRun(companyId: string, taskId: number): Promise<AutomationTaskRun> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_task_runs")
    .insert({ task_id: taskId, company_id: companyId, status: "Running" })
    .select("*")
    .single<AutomationTaskRunRow>();
  if (error) throw error;
  return automationTaskRunFromRow(data);
}

export async function finishTaskRun(companyId: string, runId: number, status: "Success" | "Failed", errorMessage: string | null, summary: Record<string, unknown>): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("automation_task_runs")
    .update({ finished_at: new Date().toISOString(), status, error_message: errorMessage, summary })
    .eq("company_id", companyId)
    .eq("id", runId);
  if (error) throw error;
}

/** Phase 25I — stale-claim recovery. `claimTaskForRunning` flips a
 * task's status to `Running` atomically, but nothing previously ever
 * revisited it if the process died before `finishTaskRun`/
 * `recordTaskOutcome` ran — `listDueTasks`'s own WHERE clause excludes
 * `Running`, so such a task was stuck there forever. This finds every
 * `Running` task whose current `automation_task_runs` row is either
 * still open (`finished_at is null`) and older than `staleBeforeIso`, or
 * missing entirely (a crash between `claimTaskForRunning` and
 * `startTaskRun` — an even more clearly broken state, always reclaimed). */
export async function listStaleRunningTasks(companyId: string, staleBeforeIso: string): Promise<AutomationTask[]> {
  const supabase = await createClient();
  const { data: runningTasks, error: tasksError } = await supabase
    .from("automation_tasks")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "Running")
    .limit(LIST_CAP)
    .returns<AutomationTaskRow[]>();
  if (tasksError) throw tasksError;
  if (runningTasks.length === 0) return [];

  const { data: openRuns, error: runsError } = await supabase
    .from("automation_task_runs")
    .select("task_id, started_at")
    .in("task_id", runningTasks.map((t) => t.id))
    .is("finished_at", null)
    .order("started_at", { ascending: false })
    .returns<{ task_id: number; started_at: string }[]>();
  if (runsError) throw runsError;

  const latestOpenStartByTaskId = new Map<number, string>();
  for (const run of openRuns) {
    if (!latestOpenStartByTaskId.has(run.task_id)) latestOpenStartByTaskId.set(run.task_id, run.started_at);
  }

  return runningTasks
    .filter((t) => {
      const startedAt = latestOpenStartByTaskId.get(t.id);
      return !startedAt || startedAt < staleBeforeIso;
    })
    .map(automationTaskFromRow);
}

/** The still-open `automation_task_runs` row for a `Running` task, if
 * any — used to close it out (as `Failed`) alongside reclaiming the
 * task itself, so a stale run never lingers open in the task's own run
 * history. */
export async function findOpenTaskRun(taskId: number): Promise<AutomationTaskRun | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_task_runs")
    .select("*")
    .eq("task_id", taskId)
    .is("finished_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<AutomationTaskRunRow>();
  if (error) throw error;
  return data ? automationTaskRunFromRow(data) : null;
}

/** Atomically reclaims one stale-`Running` task back to a terminal
 * `Failed` state, guarded by `WHERE status = 'Running'` — exactly the
 * same conditional-claim discipline as `claimTaskForRunning`, just in
 * the other direction. If the task's real run finishes (or another
 * reclaim pass gets there first) a split second before this executes,
 * the UPDATE touches zero rows and this returns `false`, and the
 * caller's own (now-stale) reclaim attempt is simply discarded — the
 * task's real, legitimate outcome is never overwritten. */
export async function reclaimStaleRunningTask(
  companyId: string,
  taskId: number,
  fields: { nextRunAt: string; lastRunAt: string; lastRunStatus: string; retryCount: number },
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_tasks")
    .update({
      status: "Failed",
      next_run_at: fields.nextRunAt,
      last_run_at: fields.lastRunAt,
      last_run_status: fields.lastRunStatus,
      retry_count: fields.retryCount,
    })
    .eq("company_id", companyId)
    .eq("id", taskId)
    .eq("status", "Running")
    .select("id");
  if (error) throw error;
  return !!data && data.length > 0;
}

export async function listTaskRuns(companyId: string, taskId: number, limit = 20): Promise<AutomationTaskRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_task_runs")
    .select("*")
    .eq("company_id", companyId)
    .eq("task_id", taskId)
    .order("started_at", { ascending: false })
    .limit(limit)
    .returns<AutomationTaskRunRow[]>();
  if (error) throw error;
  return data.map(automationTaskRunFromRow);
}

export async function listRecentTaskRuns(companyId: string, sinceIso: string): Promise<AutomationTaskRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_task_runs")
    .select("*")
    .eq("company_id", companyId)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(LIST_CAP)
    .returns<AutomationTaskRunRow[]>();
  if (error) throw error;
  return data.map(automationTaskRunFromRow);
}
