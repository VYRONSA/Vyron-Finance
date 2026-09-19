-- Phase 5I — payment details and footer text on printed documents.
--
-- PREPARED LOCALLY. NOT APPLIED TO PRODUCTION.
--
-- The 5H audit found an invoice cannot currently tell a customer HOW to
-- pay it: there is no banking block, no payment instructions and no
-- footer/terms anywhere on the document, and nothing in the data model to
-- hold them. Company identity itself is already complete (`companies`)
-- and the logo already exists (`company_branding`), so this adds only the
-- three genuinely missing pieces and reuses everything else.
--
-- 1. companies.invoice_footer
--    Free text printed at the foot of a document (trading terms, "E&OE",
--    a late-payment clause). Per company, not per invoice, because it is
--    a standing statement rather than something retyped each time.
--
-- 2. companies.payment_instructions
--    Free text printed beside the banking block ("Please use the invoice
--    number as your reference", EFT-only notes, and so on).
--
-- 3. ae_bank_accounts.show_on_documents
--    WHICH bank account to print. A company has many bank accounts and
--    most must never appear on a customer-facing document, so this is an
--    explicit opt-in per account rather than "print them all". Defaults
--    to FALSE, so applying this migration changes no existing document:
--    until somebody deliberately ticks an account, invoices print exactly
--    as they do today.
--
-- All three are text/boolean with NOT NULL defaults, so every existing
-- row is valid immediately and no backfill is required.
--
-- No accounting impact: presentation only. No posting rule, journal, VAT
-- calculation, allocation, ageing or ledger path reads any of them.

alter table companies
  add column if not exists invoice_footer text not null default '',
  add column if not exists payment_instructions text not null default '';

alter table ae_bank_accounts
  add column if not exists show_on_documents boolean not null default false;

comment on column companies.invoice_footer is
  'Free text printed at the foot of invoices/statements. Phase 5I.';
comment on column companies.payment_instructions is
  'Free text printed with the banking details on documents. Phase 5I.';
comment on column ae_bank_accounts.show_on_documents is
  'Opt-in: print this bank account on customer-facing documents. Defaults false. Phase 5I.';

-- One account at a time is the sane default for a printed remittance
-- block. This is advisory rather than enforced: a company legitimately
-- may show two (for example ZAR and USD), so no unique constraint is
-- added — the UI presents it as a single choice.
