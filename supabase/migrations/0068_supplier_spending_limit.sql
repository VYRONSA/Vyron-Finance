-- Finding #154 (Master Implementation Tracker, Programme 3 / Epic E6):
-- suppliers had no AP-side equivalent of customers.credit_limit — no way
-- to cap exposure to a single supplier before a new Purchase Order.
-- Nullable-equivalent default of 0, same "0 = no limit configured"
-- convention #036 established for the customer side.

alter table ae_suppliers add column spending_limit numeric(14, 2) not null default 0;
