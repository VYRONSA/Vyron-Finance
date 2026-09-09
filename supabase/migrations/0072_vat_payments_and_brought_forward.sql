-- Master Implementation Tracker — Programme 4, Epic E9, Root Cause
-- RC-11, Findings #202/#203.
--
-- #203 — the VAT Control account (2300) already receives the net
-- Output/Input settlement on Approve (`vat-engine.ts::buildVatSettlementJournalLines`),
-- but nothing ever clears it — there was no way to record that a return's
-- liability was actually paid to SARS. `vat_payments` is a real
-- settlement record against one specific `vat_returns` row, mirroring
-- `supplier_payments`' DR-liability/CR-bank shape (see
-- `supplier-payment-service.ts`), collapsed to a single atomic
-- record-and-post action (no Draft/Review state) since a SARS payment
-- has no internal approval workflow of its own — the VAT Return it
-- settles already went through Draft -> Review -> Approved.
create table vat_payments (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade,
  vat_return_id bigint not null references vat_returns (id) on delete cascade,
  bank_account_id bigint references ae_bank_accounts (id) on delete set null,
  payment_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  reference text not null default '',
  notes text not null default '',
  journal_id bigint references ae_journals (id) on delete set null,
  status text not null default 'Posted' check (status in ('Posted')),
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create index vat_payments_company_id_idx on vat_payments (company_id);
create index vat_payments_vat_return_id_idx on vat_payments (vat_return_id);

alter table vat_payments enable row level security;
create policy "members can access their company's vat payments" on vat_payments for all using (user_can_access_company(company_id));

-- #202 — a VAT201-style "brought forward" figure (SARS Box 14: amount
-- due/refundable including any balance carried forward) has never
-- existed on `vat_returns`. Deliberately informational/disclosure-only —
-- it is NOT folded into `net_payable`, which must stay exactly the
-- period's own Output/Input activity since that figure alone drives the
-- real settlement journal (`approveVatReturn`). Folding a brought-forward
-- balance into `net_payable` would double-post a liability that was
-- already settled via its own period's settlement journal + `vat_payments`
-- rows. Populated once at generation time from the prior period's own
-- outstanding balance (its `net_payable` less whatever `vat_payments`
-- have already settled it) — see `vat-return-service.ts::computeBroughtForward`.
alter table vat_returns add column brought_forward numeric(14, 2) not null default 0;

-- The settlement journal (DR/CR VAT Control) is a bespoke pure builder
-- (`vat-engine.ts`), but the payment journal below is a plain gross
-- two-line DR-liability/CR-bank shape — exactly what Posting Rules
-- already exist for (see 'Supplier Payment' in `seed_company_defaults()`,
-- 0007/0022). Deliberately NOT re-pasting that large, many-times-amended
-- function (0055's own comment gives the same reasoning) — a small
-- standalone, idempotent function seeds just this one rule, called once
-- per existing company below and from `company-service.ts::createCompany`
-- for every company created from now on, alongside
-- `grant_manage_opening_balances_defaults`.
create function seed_vat_payment_posting_rule(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule_id bigint;
begin
  if exists (select 1 from posting_rules where company_id = target_company_id and event_type = 'VAT Payment') then
    return;
  end if;

  insert into posting_rules (company_id, event_type, description) values (target_company_id, 'VAT Payment', 'Payment of a VAT liability to SARS') returning id into v_rule_id;
  insert into posting_rule_lines (posting_rule_id, line_order, side, role, fixed_account_code, amount_source) values
    (v_rule_id, 0, 'Debit', 'vat_control', '2300', 'gross'),
    (v_rule_id, 1, 'Credit', 'bank', '1000', 'gross');
end;
$$;

do $$
declare
  c record;
begin
  for c in select id from companies loop
    perform seed_vat_payment_posting_rule(c.id);
  end loop;
end $$;
