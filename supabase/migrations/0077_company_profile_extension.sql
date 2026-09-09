-- Phase 20D — Company Contact, Tax & Document Information. Additive
-- extension of the existing `companies` table, matching the exact
-- pattern already established by 0006_company_management.sql's own
-- `alter table companies` (text columns, `not null default ''`, never
-- SQL NULL) — every existing row gets the default automatically, no
-- manual backfill required, and every existing reader of `companies`
-- keeps working unchanged.
--
-- `name`, `registration_number`, and `address` remain the authoritative
-- legal-name/registration/physical-address fields — this migration adds
-- ADDITIONAL company profile information alongside them, never a
-- duplicate or a replacement. No new table, no banking fields, no VAT
-- treatment duplication, no organisation-level change.

alter table companies
  add column trading_name text not null default '',
  add column vat_number text not null default '',
  add column telephone text not null default '',
  add column email text not null default '',
  add column website text not null default '',
  add column postal_address text not null default '';
