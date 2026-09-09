-- Master Implementation Tracker — Programme 2, Root Cause RC-13, Finding
-- #083. Bills import parsers already extract a currency value (e.g.
-- the Xero Bills parser) but had nowhere to persist it — dropped at
-- the repository layer. Additive column, default matches the existing
-- de facto assumption everywhere else that reads an imported bill
-- without a currency concept (ZAR).
alter table ae_imported_bills add column currency text not null default 'ZAR';
