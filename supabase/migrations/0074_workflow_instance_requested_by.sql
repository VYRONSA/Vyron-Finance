-- Master Implementation Tracker — Epic E13, RC-16, Finding #125.
-- `workflow_instances` never recorded who requested the approval, so
-- `decideStep` had no way to stop the same person who submitted a
-- Communication (or a Recurring Template activation) from also
-- approving it themselves — the approval gate could always be
-- self-satisfied. Existing rows predate this column; there is no other
-- record of who started them, so they backfill to 'System' (an honest
-- "unknown" default, not a fabricated identity) rather than blocking
-- their own already-decided history.
alter table workflow_instances
  add column requested_by text not null default 'System';
