-- Phase 26E — adds the `AiClassificationSweep` standing task type to the
-- Automation Scheduler, following the exact same drop/re-add pattern
-- migrations 0028/0052/0075 already used to widen this same constraint
-- for `CommunicationQueue`/`SubscriptionLifecycleSweep`/`BankSync`. This
-- is a company-wide sweep of EXISTING/historical transactions that
-- already satisfy the unchanged AI-classification eligibility guard
-- (`isEligibleForAiClassification`/`fn_apply_ai_classification`) — no
-- change to `ae_bank_transactions`, no change to any other table, no data
-- modification.
alter table automation_tasks drop constraint automation_tasks_task_type_check;
alter table automation_tasks add constraint automation_tasks_task_type_check
  check (task_type in ('RecurringTemplate', 'RuleEngineRun', 'ReportRefresh', 'CommunicationQueue', 'Custom', 'SubscriptionLifecycleSweep', 'BankSync', 'AiClassificationSweep'));
