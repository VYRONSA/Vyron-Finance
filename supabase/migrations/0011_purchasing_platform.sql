-- Purchasing Platform (Commercial Platform, Module 4).
--
-- The mirror image of the Sales Platform (Module 3) on the AP side:
-- Purchase Requisitions -> Purchase Orders -> Goods Received Notes ->
-- Supplier Bills/Credit Notes/Debit Notes -> Supplier Payments.
--
-- Architectural decision (extend, don't duplicate — same call Supplier
-- Management made for `ae_suppliers`): "Supplier Bills" are NOT a new
-- table. `ae_imported_bills` already exists (0002_supplier_reconciliation.sql),
-- is already the one real Bill/Credit Note record in the system (Import
-- Centre, Matching Engine, Allocation Engine, Supplier Reconciliation,
-- and Supplier Management's Age Analysis/Purchase History all read it),
-- and already unifies Bill/Credit Note via `document_type` — the exact
-- pattern `sales_invoices` copied from it. Creating a second "purchase_bills"
-- table would violate the platform's own "one record per concept" rule.
--
-- What `ae_imported_bills` never had is a posting workflow: it predates
-- the General Ledger's Posting Engine (Module 10) entirely, so bills
-- imported via CSV/PDF have only ever been reconciliation data, never
-- accounting-postable documents (see that migration's own header comment
-- on this exact point). This migration adds that workflow additively —
-- `posting_status`/`journal_id`/audit stamps are all nullable and NOT
-- backfilled onto existing imported rows, so Supplier Reconciliation's
-- existing behaviour is completely unaffected (verified: its full test
-- suite stays green). Only bills that explicitly enter the new workflow
-- (via the Purchasing module, `origin = 'Purchasing'`, or a future
-- explicit "bring into workflow" action on an imported bill) ever get a
-- `posting_status`. `document_type`'s CHECK is extended to add
-- 'Debit Note' (mirroring `sales_invoices`, which already had it) since
-- Purchasing needs it and Supplier Reconciliation's existing 'Bill'/
-- 'Credit Note' rows are untouched by an additive CHECK relaxation.
--
-- Approving a Supplier Bill/Credit Note/Debit Note/Payment resolves the
-- matching seeded Posting Rule ('Supplier Invoice', 'Supplier Credit
-- Note', 'Supplier Payment' — seeded by `seed_company_defaults()` in
-- 0007_general_ledger.sql) into an Approved `ae_journals` row, then flows
-- through the one real Posting Engine, exactly like Sales. There is no
-- seeded 'Supplier Debit Note' rule — a Debit Note reuses 'Supplier
-- Invoice' (identical DR Purchases/DR VAT Input/CR Creditors shape),
-- mirroring how `sales_invoices`' own Debit Notes reuse 'Sales Invoice'.
-- Purchase Requisitions, Purchase Orders, and Goods Received Notes never
-- post — only Bills/Credit Notes/Debit Notes/Payments do.

-- ---------------------------------------------------------------------
-- Purchase Requisitions — internal approval step before a Purchase
-- Order exists. No accounting impact.
-- ---------------------------------------------------------------------

create table purchase_requisitions (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  requisition_number text not null,
  requested_by text not null default '',
  department_id bigint references departments (id) on delete set null,
  requisition_date date not null,
  status text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Approved', 'Rejected', 'Converted')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, requisition_number)
);

create index purchase_requisitions_company_id_idx on purchase_requisitions (company_id);

alter table purchase_requisitions enable row level security;
create policy "members can access their company's purchase requisitions" on purchase_requisitions for all using (user_can_access_company(company_id));

create table purchase_requisition_lines (
  id bigint generated always as identity primary key,
  requisition_id bigint not null references purchase_requisitions (id) on delete cascade,
  line_order integer not null default 0,
  description text not null default '',
  quantity numeric(14, 2) not null default 1,
  estimated_unit_price numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0
);

create index purchase_requisition_lines_requisition_id_idx on purchase_requisition_lines (requisition_id);

alter table purchase_requisition_lines enable row level security;
create policy "members can access their requisition's lines" on purchase_requisition_lines for all using (
  exists (select 1 from purchase_requisitions r where r.id = requisition_id and user_can_access_company(r.company_id))
);

-- ---------------------------------------------------------------------
-- Purchase Orders — no accounting impact. received_quantity/
-- billed_quantity per line are what GRNs/Bills update, mirroring
-- `sales_order_lines.delivered_quantity`/`invoiced_quantity` exactly.
--
-- Unlike Sales Orders (Draft -> Confirmed directly, since a customer
-- order needs no internal spend authorization), Purchase Orders carry a
-- real Submitted -> Approved/Rejected gate — an outgoing spend
-- commitment, and the PRB's own Purchasing Intelligence/Dashboard scope
-- explicitly calls for "Purchase Orders Awaiting Approval" as a real
-- metric, not a renamed "Confirmed" count.
-- ---------------------------------------------------------------------

create table purchase_orders (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  supplier_id bigint not null references ae_suppliers (id),
  requisition_id bigint references purchase_requisitions (id) on delete set null,
  order_number text not null,
  order_date date not null,
  status text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Approved', 'Rejected', 'PartiallyReceived', 'Received', 'Billed', 'Cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, order_number)
);

create index purchase_orders_company_id_idx on purchase_orders (company_id);
create index purchase_orders_supplier_id_idx on purchase_orders (supplier_id);

alter table purchase_orders enable row level security;
create policy "members can access their company's purchase orders" on purchase_orders for all using (user_can_access_company(company_id));

create table purchase_order_lines (
  id bigint generated always as identity primary key,
  order_id bigint not null references purchase_orders (id) on delete cascade,
  line_order integer not null default 0,
  description text not null default '',
  quantity numeric(14, 2) not null default 1,
  unit_price numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0,
  received_quantity numeric(14, 2) not null default 0,
  billed_quantity numeric(14, 2) not null default 0
);

create index purchase_order_lines_order_id_idx on purchase_order_lines (order_id);

alter table purchase_order_lines enable row level security;
create policy "members can access their order's lines" on purchase_order_lines for all using (
  exists (select 1 from purchase_orders o where o.id = order_id and user_can_access_company(o.company_id))
);

-- ---------------------------------------------------------------------
-- Goods Received Notes — no accounting impact (no Inventory/COGS module
-- exists yet to value what was received). Tracks fulfillment only,
-- mirroring `deliveries` exactly.
-- ---------------------------------------------------------------------

create table goods_received_notes (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  supplier_id bigint not null references ae_suppliers (id),
  order_id bigint references purchase_orders (id) on delete set null,
  grn_number text not null,
  received_date date not null,
  status text not null default 'Draft' check (status in ('Draft', 'Received', 'Cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, grn_number)
);

create index goods_received_notes_company_id_idx on goods_received_notes (company_id);
create index goods_received_notes_order_id_idx on goods_received_notes (order_id);

alter table goods_received_notes enable row level security;
create policy "members can access their company's goods received notes" on goods_received_notes for all using (user_can_access_company(company_id));

create table goods_received_note_lines (
  id bigint generated always as identity primary key,
  grn_id bigint not null references goods_received_notes (id) on delete cascade,
  order_line_id bigint references purchase_order_lines (id) on delete set null,
  line_order integer not null default 0,
  description text not null default '',
  quantity numeric(14, 2) not null default 1
);

create index goods_received_note_lines_grn_id_idx on goods_received_note_lines (grn_id);

alter table goods_received_note_lines enable row level security;
create policy "members can access their GRN's lines" on goods_received_note_lines for all using (
  exists (select 1 from goods_received_notes g where g.id = grn_id and user_can_access_company(g.company_id))
);

-- ---------------------------------------------------------------------
-- ae_imported_bills — extended, not replaced. See the header comment
-- above for the full reasoning. Every new column is nullable/defaulted
-- so every existing imported row and every existing reader (Matching
-- Engine, Allocation Engine, Supplier Reconciliation, Supplier
-- Management) is completely unaffected.
-- ---------------------------------------------------------------------

alter table ae_imported_bills
  add column origin text not null default 'Imported' check (origin in ('Imported', 'Purchasing')),
  add column purchase_order_id bigint references purchase_orders (id) on delete set null,
  add column goods_received_note_id bigint references goods_received_notes (id) on delete set null,
  add column posting_status text check (posting_status in ('Draft', 'Submitted', 'Approved', 'Posted', 'Cancelled')),
  add column journal_id bigint references ae_journals (id) on delete set null,
  add column submitted_by text,
  add column submitted_at timestamptz,
  add column approved_by text,
  add column approved_at timestamptz,
  add column posted_at timestamptz,
  add column cancelled_by text,
  add column cancelled_at timestamptz;

alter table ae_imported_bills drop constraint ae_imported_bills_document_type_check;
alter table ae_imported_bills add constraint ae_imported_bills_document_type_check check (document_type in ('Bill', 'Credit Note', 'Debit Note'));

create index ae_imported_bills_purchase_order_id_idx on ae_imported_bills (purchase_order_id);

-- ---------------------------------------------------------------------
-- Supplier Payments — the other document type that posts. Allocations
-- are a sub-ledger detail only (which bill a payment settled) and do NOT
-- themselves generate a journal — the payment's own journal already
-- captures the full accounting effect (DR Creditors, CR Bank).
-- Allocation is deliberately not restricted to `origin = 'Purchasing'`
-- bills — a payment can settle ANY outstanding bill regardless of how it
-- arrived, matching how the existing Allocation Engine already treats
-- bills uniformly.
-- ---------------------------------------------------------------------

create table supplier_payments (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  supplier_id bigint not null references ae_suppliers (id),
  bank_account_id bigint references ae_bank_accounts (id) on delete set null,
  payment_number text not null,
  payment_date date not null,
  amount numeric(14, 2) not null default 0,
  status text not null default 'Draft' check (status in ('Draft', 'Approved', 'Posted', 'Cancelled')),
  journal_id bigint references ae_journals (id) on delete set null,
  reference text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  unique (company_id, payment_number)
);

create index supplier_payments_company_id_idx on supplier_payments (company_id);
create index supplier_payments_supplier_id_idx on supplier_payments (supplier_id);

alter table supplier_payments enable row level security;
create policy "members can access their company's supplier payments" on supplier_payments for all using (user_can_access_company(company_id));

create table supplier_payment_allocations (
  id bigint generated always as identity primary key,
  payment_id bigint not null references supplier_payments (id) on delete cascade,
  bill_id bigint not null references ae_imported_bills (id),
  amount_allocated numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index supplier_payment_allocations_payment_id_idx on supplier_payment_allocations (payment_id);
create index supplier_payment_allocations_bill_id_idx on supplier_payment_allocations (bill_id);

alter table supplier_payment_allocations enable row level security;
create policy "members can access their payment's allocations" on supplier_payment_allocations for all using (
  exists (select 1 from supplier_payments p where p.id = payment_id and user_can_access_company(p.company_id))
);
