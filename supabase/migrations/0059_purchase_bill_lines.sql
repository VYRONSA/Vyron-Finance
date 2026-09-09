-- Product Review Board — "Additional Requirement: Purchase Processing."
-- ae_imported_bills has always been header-only (a single net amount +
-- one VAT treatment + one GL account per document — see
-- purchase-bill-repository.ts's own module comment for why: imported
-- bills never had lines either, so a Purchasing-entered bill matched
-- that shape). The Board's requirement is explicit: Purchases/Bills/
-- Credit Notes/Debit Notes must support unlimited lines, each with its
-- own GL account, VAT code, cost centre, project, department,
-- description, quantity, unit cost, and discount.
--
-- Additive, not a schema rewrite: ae_imported_bills keeps its existing
-- gl_account/vat_code/vat/total columns as header-level ROLL-UPS. A
-- bill with lines has them computed from ae_purchase_bill_lines; a
-- bill with none (every existing row, every future imported/CSV/PDF
-- row, and Purchase-Order-derived bills, which still sum to one net
-- amount) keeps working exactly as before. This mirrors the same
-- "extend, don't duplicate" philosophy 0011_purchasing_platform.sql's
-- own header comment already established for this table.
--
-- Dimensions follow the one existing precedent for a transaction line
-- carrying GL + VAT + cost centre + project + department together:
-- bank_transaction_splits (0023_matching_platform.sql) — cost_centre_id/
-- project_id/department_id are all nullable ("where applicable", per
-- the Board's own wording, not every line needs every dimension).
create table ae_purchase_bill_lines (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  bill_id bigint not null references ae_imported_bills (id) on delete cascade,
  line_order integer not null default 0,
  description text not null default '',
  gl_account text not null default '',
  vat_code text not null default '',
  cost_centre_id bigint references cost_centres (id) on delete set null,
  project_id bigint references projects (id) on delete set null,
  department_id bigint references departments (id) on delete set null,
  quantity numeric not null default 1,
  unit_cost numeric not null default 0,
  discount numeric not null default 0,
  net_amount numeric not null default 0,
  vat_amount numeric not null default 0,
  line_total numeric not null default 0,
  created_at timestamptz not null default now()
);

create index ae_purchase_bill_lines_bill_id_idx on ae_purchase_bill_lines (bill_id);
create index ae_purchase_bill_lines_company_id_idx on ae_purchase_bill_lines (company_id, bill_id);

alter table ae_purchase_bill_lines enable row level security;
create policy "members can access their company's purchase bill lines" on ae_purchase_bill_lines for all using (user_can_access_company(company_id));
