-- Sales Platform (Commercial Platform, Module 3).
--
-- The complete sales lifecycle: Quotations -> Sales Orders -> Deliveries
-- -> Customer Invoices/Credit Notes/Debit Notes -> Customer Receipts.
-- Genuinely new — no reference-app equivalent exists on either backend.
--
-- Accounting integration follows the architecture General Ledger (Module
-- 10) already established: nothing here writes to gl_transactions
-- directly. Approving a Sales Invoice/Credit Note/Debit Note/Receipt
-- resolves the matching seeded Posting Rule (Sales Invoice, Customer
-- Credit Note, Customer Receipt — all seeded by `seed_company_defaults()`
-- in 0007_general_ledger.sql) into an Approved `ae_journals` row, which
-- then flows through the one real Posting Engine
-- (`posting-engine-service.ts::postApprovedJournals`) exactly like any
-- other journal. Quotations, Sales Orders, and Deliveries never post —
-- only Invoices/Credit Notes/Debit Notes/Receipts do, matching standard
-- accounting practice (a quote or an order is a commitment, not a
-- transaction).
--
-- VAT is deliberately whole-document (one `vat_treatment_code` per
-- document, not per line) — the Posting Rule engine's
-- `buildJournalLinesFromRule` already only supports one blended VAT rate
-- per event, so this keeps the two systems' capabilities matched rather
-- than half-building per-line VAT splitting the posting side can't use
-- yet.

-- ---------------------------------------------------------------------
-- Quotations — no accounting impact.
-- ---------------------------------------------------------------------

create table sales_quotations (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  customer_id bigint not null references customers (id),
  quotation_number text not null,
  quotation_date date not null,
  expiry_date date,
  status text not null default 'Draft' check (status in ('Draft', 'Sent', 'Accepted', 'Rejected', 'Expired', 'Converted')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, quotation_number)
);

create index sales_quotations_company_id_idx on sales_quotations (company_id);
create index sales_quotations_customer_id_idx on sales_quotations (customer_id);

alter table sales_quotations enable row level security;
create policy "members can access their company's quotations" on sales_quotations for all using (user_can_access_company(company_id));

create table sales_quotation_lines (
  id bigint generated always as identity primary key,
  quotation_id bigint not null references sales_quotations (id) on delete cascade,
  line_order integer not null default 0,
  description text not null default '',
  quantity numeric(14, 2) not null default 1,
  unit_price numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0
);

create index sales_quotation_lines_quotation_id_idx on sales_quotation_lines (quotation_id);

alter table sales_quotation_lines enable row level security;
create policy "members can access their quotation's lines" on sales_quotation_lines for all using (
  exists (select 1 from sales_quotations q where q.id = quotation_id and user_can_access_company(q.company_id))
);

-- ---------------------------------------------------------------------
-- Sales Orders — no accounting impact. delivered_quantity/
-- invoiced_quantity per line are what Deliveries/Invoices update, so
-- Partial Deliveries and Backorders are computable (ordered - delivered).
-- ---------------------------------------------------------------------

create table sales_orders (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  customer_id bigint not null references customers (id),
  quotation_id bigint references sales_quotations (id) on delete set null,
  order_number text not null,
  order_date date not null,
  status text not null default 'Draft' check (status in ('Draft', 'Confirmed', 'PartiallyDelivered', 'Delivered', 'Invoiced', 'Cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, order_number)
);

create index sales_orders_company_id_idx on sales_orders (company_id);
create index sales_orders_customer_id_idx on sales_orders (customer_id);

alter table sales_orders enable row level security;
create policy "members can access their company's sales orders" on sales_orders for all using (user_can_access_company(company_id));

create table sales_order_lines (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_orders (id) on delete cascade,
  line_order integer not null default 0,
  description text not null default '',
  quantity numeric(14, 2) not null default 1,
  unit_price numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0,
  delivered_quantity numeric(14, 2) not null default 0,
  invoiced_quantity numeric(14, 2) not null default 0
);

create index sales_order_lines_order_id_idx on sales_order_lines (order_id);

alter table sales_order_lines enable row level security;
create policy "members can access their order's lines" on sales_order_lines for all using (
  exists (select 1 from sales_orders o where o.id = order_id and user_can_access_company(o.company_id))
);

-- ---------------------------------------------------------------------
-- Deliveries — no accounting impact (no Inventory/COGS module exists
-- yet to value what was delivered). Tracks fulfillment only.
-- ---------------------------------------------------------------------

create table deliveries (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  customer_id bigint not null references customers (id),
  order_id bigint references sales_orders (id) on delete set null,
  delivery_number text not null,
  delivery_date date not null,
  status text not null default 'Draft' check (status in ('Draft', 'Delivered', 'Cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, delivery_number)
);

create index deliveries_company_id_idx on deliveries (company_id);
create index deliveries_order_id_idx on deliveries (order_id);

alter table deliveries enable row level security;
create policy "members can access their company's deliveries" on deliveries for all using (user_can_access_company(company_id));

create table delivery_lines (
  id bigint generated always as identity primary key,
  delivery_id bigint not null references deliveries (id) on delete cascade,
  order_line_id bigint references sales_order_lines (id) on delete set null,
  line_order integer not null default 0,
  description text not null default '',
  quantity numeric(14, 2) not null default 1
);

create index delivery_lines_delivery_id_idx on delivery_lines (delivery_id);

alter table delivery_lines enable row level security;
create policy "members can access their delivery's lines" on delivery_lines for all using (
  exists (select 1 from deliveries d where d.id = delivery_id and user_can_access_company(d.company_id))
);

-- ---------------------------------------------------------------------
-- Sales Invoices — Invoice/Credit Note/Debit Note unified in one table
-- with a document_type flag, the same shape `ae_imported_bills` already
-- uses on the supplier side. The ONE document type in this module that
-- posts to the General Ledger.
-- ---------------------------------------------------------------------

create table sales_invoices (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  customer_id bigint not null references customers (id),
  order_id bigint references sales_orders (id) on delete set null,
  delivery_id bigint references deliveries (id) on delete set null,
  invoice_number text not null,
  document_type text not null default 'Invoice' check (document_type in ('Invoice', 'Credit Note', 'Debit Note')),
  invoice_date date not null,
  due_date date,
  vat_treatment_code text not null default '',
  status text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Approved', 'Posted', 'Cancelled')),
  journal_id bigint references ae_journals (id) on delete set null,
  subtotal numeric(14, 2) not null default 0,
  vat_amount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  outstanding numeric(14, 2) not null default 0,
  is_recurring_template boolean not null default false,
  recurrence_pattern text not null default '',
  reference text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  unique (company_id, invoice_number)
);

create index sales_invoices_company_id_idx on sales_invoices (company_id);
create index sales_invoices_customer_id_idx on sales_invoices (customer_id);

alter table sales_invoices enable row level security;
create policy "members can access their company's sales invoices" on sales_invoices for all using (user_can_access_company(company_id));

create table sales_invoice_lines (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references sales_invoices (id) on delete cascade,
  line_order integer not null default 0,
  description text not null default '',
  quantity numeric(14, 2) not null default 1,
  unit_price numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0
);

create index sales_invoice_lines_invoice_id_idx on sales_invoice_lines (invoice_id);

alter table sales_invoice_lines enable row level security;
create policy "members can access their invoice's lines" on sales_invoice_lines for all using (
  exists (select 1 from sales_invoices i where i.id = invoice_id and user_can_access_company(i.company_id))
);

-- ---------------------------------------------------------------------
-- Customer Receipts — the other document type that posts. Allocations
-- are a sub-ledger detail (which invoice a receipt paid off) and do NOT
-- themselves generate a journal — the receipt's own journal already
-- captures the full accounting effect (DR Bank, CR Debtors); allocation
-- only updates which invoice(s)' `outstanding` the payment reduces,
-- exactly matching how a real AR sub-ledger works.
-- ---------------------------------------------------------------------

create table customer_receipts (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  customer_id bigint not null references customers (id),
  bank_account_id bigint references ae_bank_accounts (id) on delete set null,
  receipt_number text not null,
  receipt_date date not null,
  amount numeric(14, 2) not null default 0,
  status text not null default 'Draft' check (status in ('Draft', 'Approved', 'Posted', 'Cancelled')),
  journal_id bigint references ae_journals (id) on delete set null,
  reference text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  unique (company_id, receipt_number)
);

create index customer_receipts_company_id_idx on customer_receipts (company_id);
create index customer_receipts_customer_id_idx on customer_receipts (customer_id);

alter table customer_receipts enable row level security;
create policy "members can access their company's customer receipts" on customer_receipts for all using (user_can_access_company(company_id));

create table customer_receipt_allocations (
  id bigint generated always as identity primary key,
  receipt_id bigint not null references customer_receipts (id) on delete cascade,
  invoice_id bigint not null references sales_invoices (id),
  amount_allocated numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index customer_receipt_allocations_receipt_id_idx on customer_receipt_allocations (receipt_id);
create index customer_receipt_allocations_invoice_id_idx on customer_receipt_allocations (invoice_id);

alter table customer_receipt_allocations enable row level security;
create policy "members can access their receipt's allocations" on customer_receipt_allocations for all using (
  exists (select 1 from customer_receipts r where r.id = receipt_id and user_can_access_company(r.company_id))
);
