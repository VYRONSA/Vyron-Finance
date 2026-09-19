-- Down script for 0108_supplier_invoice_capture.sql.
--
-- Drops the whole Supplier Invoice Capture feature. Safe for the ledger:
-- this migration never wrote to an accounting table. Draft bills already
-- created from a capture are ORDINARY purchase bills and are NOT removed —
-- they lose only their `bill_id` backlink, which lives on the capture.
--
-- What is lost: every uploaded capture's extracted data, its review
-- corrections, its audit trail, the learned supplier line mappings, and the
-- provider attempt metadata. The uploaded FILES are untouched — they are
-- ordinary Document Platform rows.
--
-- Run the application rollback FIRST: the routes and the automation task
-- call these tables and functions.

drop function if exists fn_ai_extraction_gate(uuid, bigint, timestamptz, text);
drop function if exists fn_ai_extraction_record_attempt(uuid, bigint, bigint, integer, text, boolean, text, text, integer, text, jsonb, integer, text, text, timestamptz, text, boolean);

drop table if exists ai_extraction_attempts;
drop table if exists supplier_line_mappings;
drop table if exists supplier_invoice_capture_events;
drop table if exists supplier_invoice_capture_lines;
drop table if exists supplier_invoice_captures;

alter table automation_tasks drop constraint if exists automation_tasks_task_type_check;
alter table automation_tasks add constraint automation_tasks_task_type_check
  check (task_type in (
    'RecurringTemplate', 'RuleEngineRun', 'ReportRefresh', 'CommunicationQueue', 'Custom',
    'SubscriptionLifecycleSweep', 'BankSync', 'AiClassificationSweep'
  ));

drop index if exists documents_company_content_hash_idx;
alter table documents drop column if exists content_sha256;
