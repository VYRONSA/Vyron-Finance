-- Phase 5I — supplier registration number.
--
-- PREPARED LOCALLY. NOT APPLIED TO PRODUCTION.
--
-- Why this column is genuinely needed rather than convenient:
--
--   1. Parity with the customer side. `customers.registration_number`
--      has existed since 0008 and is used by the statement document, by
--      duplicate detection and by the audit-tests engine. The supplier
--      side has no equivalent, so the same business identity is
--      recorded for one counterparty type and not the other.
--
--   2. Duplicate detection. `duplicate-detection-engine.ts` compares
--      customers on name + VAT number + registration number, but
--      suppliers on name + VAT number + BANK ACCOUNT NUMBER — it falls
--      back to banking details precisely because no registration number
--      exists. That makes the supplier comparison both weaker and more
--      sensitive than it needs to be.
--
--   3. Capture. The Xero importer already PARSES a supplier registration
--      number (`xero-contacts-parser.ts`) and then discards it, because
--      there is nowhere to put it.
--
-- Deliberately mirrors `customers.registration_number` exactly: text,
-- NOT NULL, default '' — so every existing row is valid the moment this
-- applies, no backfill is needed, and no read path can encounter NULL.
-- Nothing reads it yet beyond the supplier form and detail panel; this
-- adds a field, not a behaviour.
--
-- No accounting impact: no posting rule, journal, VAT calculation,
-- allocation or ledger path reads this column.

alter table ae_suppliers
  add column if not exists registration_number text not null default '';

comment on column ae_suppliers.registration_number is
  'Company registration number (YYYY/NNNNNN/NN). Mirrors customers.registration_number. Phase 5I.';
