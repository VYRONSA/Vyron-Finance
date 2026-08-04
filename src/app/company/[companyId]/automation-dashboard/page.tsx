import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutiveSummaryBar } from "@/components/financial/executive-summary-bar";
import { AutomationDashboardTab } from "@/components/financial/automation/automation-dashboard-tab";
import { IconAlertTriangle, IconBanknote, IconClock, IconImport, IconListChecks, IconReconcile, IconRefresh, IconShieldCheck } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listAutomationTasks, listRecentTaskRuns } from "@/server/services/scheduler-service";
import { listAuditLog } from "@/server/services/automation-audit-service";
import { listBankingExceptions } from "@/server/services/banking-exception-service";
import { getBankingAutomationAggregate } from "@/server/services/transaction-explorer-service";
import { buildAutomationDashboardSummary } from "@/server/services/automation-dashboard-summary-service";
import { MOCK_AUDIT_LOG, MOCK_AUTOMATION_TASKS, MOCK_AUTOMATION_TASK_RUNS } from "@/lib/mock/automation-data";
import { MOCK_BANKING_EXCEPTIONS } from "@/lib/mock/banking-automation-data";
import { MOCK_BANKING_AGGREGATE } from "@/lib/mock/transaction-explorer-data";

export const metadata: Metadata = {
  title: "Automation Dashboard — VYRON FINANCE",
};

export default async function AutomationDashboardPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const todayIso = new Date().toISOString().slice(0, 10);
  // Launch Blocker fix (post-RC2): was `listTransactionsForExport(...).then(r
  // => r.transactions.length)` — pulling the company's entire bank
  // transaction history just to count it. `getBankingAutomationAggregate`
  // is one server-side aggregate query; see banking-summary-service.ts's
  // own comment for the full evidence.
  const [tasks, runsToday, auditLog, exceptions, bankingAggregate] = previewMode
    ? [MOCK_AUTOMATION_TASKS, MOCK_AUTOMATION_TASK_RUNS, MOCK_AUDIT_LOG, MOCK_BANKING_EXCEPTIONS, MOCK_BANKING_AGGREGATE]
    : await Promise.all([
        listAutomationTasks(companyId),
        listRecentTaskRuns(companyId, `${todayIso}T00:00:00.000Z`),
        listAuditLog(companyId),
        listBankingExceptions(companyId, "Open"),
        getBankingAutomationAggregate(companyId),
      ]);

  const summary = buildAutomationDashboardSummary(tasks, runsToday, exceptions.length, bankingAggregate.totalTransactions);

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }}
        />
        <CardContent className="relative flex flex-wrap items-center justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">
              Recurring Transactions & Autonomous Automation
            </span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Automation Dashboard</h1>
            <p className="mt-1.5 max-w-[64ch] text-sm text-vf-on-dark-soft">
              How much work the platform performed automatically today, how much still needs a person, and the
              Scheduler&rsquo;s own operational health.
            </p>
          </div>
        </CardContent>
      </Card>

      <ExecutiveSummaryBar
        items={[
          { key: "automationRate", label: "Automation Rate", value: `${summary.automationRatePercent}%`, icon: IconReconcile },
          { key: "tasksExecutedToday", label: "Tasks Executed Today", value: String(summary.tasksExecutedToday), icon: IconListChecks },
          { key: "tasksWaiting", label: "Tasks Waiting", value: String(summary.tasksWaiting), icon: IconClock },
          { key: "failedTasks", label: "Failed Tasks", value: String(summary.failedTasks), icon: IconAlertTriangle },
          { key: "retryQueue", label: "Retry Queue", value: String(summary.retryQueueCount), icon: IconRefresh },
          { key: "ruleSuccessRate", label: "Rule Success Rate", value: `${summary.ruleSuccessRatePercent}%`, icon: IconShieldCheck },
          { key: "ruleFailureRate", label: "Rule Failure Rate", value: `${summary.ruleFailureRatePercent}%`, icon: IconAlertTriangle },
          { key: "schedulerHealth", label: "Scheduler Health", value: summary.schedulerHealth, icon: IconShieldCheck },
          { key: "avgProcessing", label: "Avg Processing Time", value: `${summary.averageProcessingTimeMs}ms`, icon: IconClock },
          { key: "manualIntervention", label: "Manual Intervention Rate", value: `${summary.manualInterventionRatePercent}%`, icon: IconBanknote },
        ]}
      />

      {summary.topAutomatedProcesses.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap gap-4 pt-5">
            <p className="w-full text-sm font-semibold text-vf-ink">Top Automated Processes Today</p>
            {summary.topAutomatedProcesses.map((p) => (
              <div key={p.name} className="rounded-vf-md border border-vf-paper-border px-3 py-2 text-sm">
                <span className="font-medium text-vf-ink">{p.name}</span>{" "}
                <span className="font-mono tabular-nums text-vf-ink-faint">×{p.successCount}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {previewMode && (
        <p className="flex items-center gap-1.5 text-xs text-vf-ink-faint">
          <IconImport className="h-3.5 w-3.5" />
          Preview Mode — showing sample automation activity. Every action is disabled until Supabase is configured.
        </p>
      )}

      <AutomationDashboardTab companyId={companyId} tasks={tasks} auditLog={auditLog} previewMode={previewMode} />
    </div>
  );
}
