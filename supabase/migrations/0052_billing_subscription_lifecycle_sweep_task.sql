-- Commercial Billing Platform — Sub-Phase 4. "The Scheduler must own
-- expiry. Never rely on login-time checks." This widens the EXISTING
-- Automation Scheduler's `automation_tasks.task_type` to add
-- `'SubscriptionLifecycleSweep'` — the exact same precedent already
-- used to add `CommunicationQueue` for the Communication Platform
-- (`0028_communication_platform.sql`): "reuses the EXISTING Automation
-- Scheduler rather than inventing a second scheduler loop." No new
-- cron route, no second scheduling mechanism — `runDueTasks` (the ONE
-- place scheduled work executes, per `scheduler-service.ts`'s own
-- header) gets one more task-type branch.

alter table automation_tasks drop constraint automation_tasks_task_type_check;
alter table automation_tasks add constraint automation_tasks_task_type_check
  check (task_type in ('RecurringTemplate', 'RuleEngineRun', 'ReportRefresh', 'CommunicationQueue', 'Custom', 'SubscriptionLifecycleSweep'));

-- Tracks whether the one-time "your trial is ending soon" warning has
-- already been issued for the CURRENT trial, so a daily sweep sends it
-- exactly once rather than re-notifying on every run inside the warning
-- window. Reset is implicit: a new subscription (a fresh trial, or a
-- resubscribe) is a new row with this column null again.
alter table subscriptions add column trial_warning_sent_at timestamptz;
