-- Phase 5J — the document particulars a credit/debit note is required to
-- carry, and the payment terms an invoice's due date is derived from.
--
-- Purely additive. Every column below is nullable or defaults to a value
-- that reproduces exactly what an existing row already means, so no
-- historical document changes and nothing needs recalculating.
--
-- 1. `sales_invoices.reason`
--
--    VAT Act s21(3) requires a credit or debit note to state "the reason
--    for" the adjustment, alongside the original tax invoice's details.
--    `original_invoice_id` was added by 0071 (Finding #114) but there was
--    nowhere to record WHY, so no credit note this system produced could
--    carry that particular.
--
--    Defaults to '' rather than being `not null` without a default,
--    because existing credit notes genuinely do not have one recorded and
--    inventing text for them would be fabricating a tax record. New
--    credit/debit notes are required to supply one — enforced in
--    `sales-invoice-service.ts`, where the message can name the field,
--    not by a CHECK constraint that would retroactively invalidate every
--    note already issued.
--
-- 2. `sales_invoices.payment_terms_days`
--
--    What the due date on THIS document was computed from, captured at
--    issue. `customers.payment_terms_days` can be edited afterwards; an
--    invoice's due date must not silently change when it is. Nullable:
--    null means "this document predates the derivation" or "the due date
--    was set by hand", both of which are true statements about existing
--    rows, whereas 0 or 30 would be a guess.
--
-- 3. `companies.default_payment_terms_days`
--
--    The company-level fallback for a customer with no terms of their
--    own. `customers.payment_terms_days` has been `not null default 30`
--    since 0008, so this is the second rung of the hierarchy, not the
--    first. Defaults to 30 to match the customer default already in
--    force — this introduces no new behaviour on its own.

alter table sales_invoices
  add column if not exists reason text not null default '',
  add column if not exists payment_terms_days integer;

alter table sales_invoices
  drop constraint if exists sales_invoices_payment_terms_days_check;
alter table sales_invoices
  add constraint sales_invoices_payment_terms_days_check
  check (payment_terms_days is null or payment_terms_days >= 0);

alter table companies
  add column if not exists default_payment_terms_days integer not null default 30;

alter table companies
  drop constraint if exists companies_default_payment_terms_days_check;
alter table companies
  add constraint companies_default_payment_terms_days_check
  check (default_payment_terms_days >= 0);

comment on column sales_invoices.reason is
  'Phase 5J — why this credit/debit note was issued (VAT Act s21(3)). Always empty on an Invoice.';
comment on column sales_invoices.payment_terms_days is
  'Phase 5J — the terms this document''s due date was derived from, captured at issue. Null for a hand-set or pre-5J due date.';
comment on column companies.default_payment_terms_days is
  'Phase 5J — fallback used when a customer has no payment terms of their own.';
