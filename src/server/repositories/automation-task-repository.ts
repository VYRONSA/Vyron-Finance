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
