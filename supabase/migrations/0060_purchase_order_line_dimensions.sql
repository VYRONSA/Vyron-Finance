-- Product Review Board — "Final Outstanding Items Before Phase 9 Can Be
-- Closed", item 1: the multi-line spreadsheet capture requirement (GL
-- allocation, VAT allocation, cost centre, project, department, running
-- totals, single-post workflow) applies to Purchase Orders too, not
-- just Bills/Credit Notes/Debit Notes (0059_purchase_bill_lines.sql).
--
-- Additive, not a schema rewrite: every new column is nullable (or
-- defaults to a value that reproduces today's exact behaviour), so
-- every existing purchase_order_lines row — captured before GL/VAT
-- dimensions existed on this table — is completely unaffected.
--
-- line_total's own meaning is deliberately preserved, not redefined: it
-- has always been quantity*unit_price (no VAT concept existed before
-- today). With vat_code left null (every pre-existing row, and any new
-- row a caller doesn't dimension), vat_amount computes to 0 and
-- line_total = net_amount unchanged — the exact same number this
-- column has always held. Only once a line carries a real vat_code does
-- line_total become genuinely gross (net + vat), mirroring
-- ae_purchase_bill_lines exactly, which is what lets
-- purchase-bill-service.ts::createBillFromOrder build a real multi-line
-- Bill straight from a dimensioned Purchase Order's own lines instead
-- of collapsing them into one number.
alter table purchase_order_lines
  add column gl_account text,
  add column vat_code text,
  add column cost_centre_id bigint references cost_centres (id) on delete set null,
  add column project_id bigint references projects (id) on delete set null,
  add column department_id bigint references departments (id) on delete set null,
  add column discount numeric not null default 0,
  add column net_amount numeric not null default 0,
  add column vat_amount numeric not null default 0;
