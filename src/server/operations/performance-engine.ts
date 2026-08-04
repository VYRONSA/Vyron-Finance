/**
 * Pure Performance Dashboard aggregation. Per the directive's own
 * explicit instruction: "If CPU, memory, or infrastructure metrics are
 * unavailable, expose them as Not Available – Monitoring Provider
 * Required instead of inventing values." This codebase has no APM/request-
 * timing persistence anywhere (confirmed by this phase's own research —
 * only `automation_task_runs`' duration columns exist) — so only
 * Scheduler/Rule-Engine/Communication-Queue duration (the tasks the
 * Scheduler itself times) are `Live`/`Calculated`; every other named
 * metric is honestly `NotAvailable`.
 */

import type { AutomationTaskRun, AutomationTaskType } from "@/server/automation/types";
import type { Metric } from "./types";

const notAvailable = <T>(note: string): Metric<T> => ({ value: null, quality: "NotAvailable", note });

export type TaskDuration = { taskType: AutomationTaskType; avgDurationMs: number | null; lastDurationMs: number | null; sampleCount: number };

export type PerformanceSummary = {
  schedulerTaskDurations: TaskDuration[];
  slowestQueries: Metric<string[]>;
  slowestPages: Metric<string[]>;
  slowestReports: Metric<string[]>;
  slowestApis: Metric<string[]>;
  largestDatasets: Metric<string[]>;
  memoryUsage: Metric<number>;
  cpuUsage: Metric<number>;
};

const MONITORING_PROVIDER_NOTE = "Not Available – Monitoring Provider Required";

export function summarizeTaskDurations(runsByType: Record<string, AutomationTaskRun[]>): TaskDuration[] {
  return Object.entries(runsByType).map(([taskType, runs]) => {
    const finished = runs.filter((r) => r.finishedAt);
    const durations = finished.map((r) => Date.parse(r.finishedAt as string) - Date.parse(r.startedAt));
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    return { taskType: taskType as AutomationTaskType, avgDurationMs: avg, lastDurationMs: durations[0] ?? null, sampleCount: finished.length };
  });
}

export function buildPerformanceSummary(runsByType: Record<string, AutomationTaskRun[]>): PerformanceSummary {
  return {
    schedulerTaskDurations: summarizeTaskDurations(runsByType),
    slowestQueries: notAvailable(MONITORING_PROVIDER_NOTE),
    slowestPages: notAvailable(MONITORING_PROVIDER_NOTE),
    slowestReports: notAvailable(MONITORING_PROVIDER_NOTE),
    slowestApis: notAvailable(MONITORING_PROVIDER_NOTE),
    largestDatasets: notAvailable(MONITORING_PROVIDER_NOTE),
    memoryUsage: notAvailable(MONITORING_PROVIDER_NOTE),
    cpuUsage: notAvailable(MONITORING_PROVIDER_NOTE),
  };
}
