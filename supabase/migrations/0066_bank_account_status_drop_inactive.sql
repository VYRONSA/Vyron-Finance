-- Finding #078 (Master Implementation Tracker, Programme 2 / Epic E5):
-- "Inactive" was a real, constraint-legal bank_accounts.status value
-- with its own UI badge styling, but no code path ever wrote it —
-- Archive/Reactivate (Active <-> Archived) already covers the practical
-- need. Backfill first (defensive — no row is expected to hold
-- 'Inactive' today, per the application-code audit that motivated this
-- migration) so the narrower constraint can never reject existing data.

update ae_bank_accounts set status = 'Active' where status = 'Inactive';

alter table ae_bank_accounts drop constraint ae_bank_accounts_status_check;
alter table ae_bank_accounts add constraint ae_bank_accounts_status_check check (status in ('Active', 'Archived'));
