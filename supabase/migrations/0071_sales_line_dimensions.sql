-- Finding #113 — mirrors 0060_purchase_order_line_dimensions.sql exactly,
-- applied to Sales Order lines instead of Purchase Order lines. Additive:
-- every new column is nullable or defaults to a value that reproduces
-- today's exact behaviour (vat_code null -> vat_amount 0 -> line_total
-- unchanged at quantity*unit_price for every pre-existing row).
alter table sales_order_lines
  add column gl_account text,
  add column vat_code text,
  add column cost_centre_id bigint references cost_centres (id) on delete set null,
  add column project_id bigint references projects (id) on delete set null,
  add column department_id bigint references departments (id) on delete set null,
  add column discount numeric not null default 0,
  add column net_amount numeric not null default 0,
  add column vat_amount numeric not null default 0;

-- Finding #112 — Quotations had no VAT concept at all (header or line).
-- Narrower than the Order/Bill dimension set above — just the VAT pair,
-- same additive/backward-compatible shape.
alter table sales_quotation_lines
  add column vat_code text,
  add column vat_amount numeric not null default 0;

-- Finding #165 — Sales Invoice lines had no per-line VAT/discount at
-- all, only the header-level vat_treatment_code. Mirrors the Sales
-- Order shape above (optional/nullable — an Invoice already has that
-- header-level VAT a line can optionally override), not Purchase Bill's
-- required-per-line shape.
alter table sales_invoice_lines
  add column gl_account text,
  add column vat_code text,
  add column discount numeric not null default 0,
  add column net_amount numeric not null default 0,
  add column vat_amount numeric not null default 0;

-- Finding #114 — a Credit Note had no reference to the Invoice it
-- reverses. Nullable — a Credit Note doesn't have to name one specific
-- original invoice (a general goodwill credit is still valid).
alter table sales_invoices
  add column original_invoice_id bigint references sales_invoices (id) on delete set null;
