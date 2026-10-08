-- Rollback for 0117_supplier_statement_document_reconciliation.sql.
--
-- Restores the 0115 statement guard and run insert guard verbatim, and the
-- 0115 vocabularies. REFUSES while any document-basis run exists (runs are
-- immutable evidence: they are never deleted to make a rollback possible).

begin;

do $$
begin
  if exists (select 1 from supplier_statement_reconciliations where basis = 'supplier-statement-documents')
     or exists (select 1 from supplier_statement_reconciliation_items where category = 'Out of Scope' or match_tier = 'zero-padded') then
    raise exception '0117 rollback refused: document-basis reconciliation runs exist (they are immutable evidence)';
  end if;
end $$;

create or replace function fn_supplier_statement_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- server paths (service role, owner)
  end if;
  if current_user = 'anon' or auth.uid() is null then
    raise exception 'supplier statements require a signed-in user' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if not user_has_permission(new.company_id, 'Purchasing:Create') then
      raise exception 'Purchasing:Create is required to upload a supplier statement' using errcode = '42501';
    end if;
    if new.status <> 'Queued'
       or new.source_type not in ('pdf', 'image', 'csv', 'xlsx')
       or new.validation_status <> 'Pending'
       or new.supplier_candidates <> '[]'::jsonb
       or new.validation_findings <> '[]'::jsonb
       or new.warnings <> '[]'::jsonb
       or new.status_reason <> ''
       or new.manual_entry
       or new.sign_convention <> 'debit-increases-owed'
       or num_nonnulls(
            new.extraction_method, new.duplicate_of_statement_id, new.supplier_id, new.supplier_match_tier,
            new.supplier_confirmed_by, new.supplier_confirmed_at,
            new.supplier_name_extracted, new.supplier_vat_extracted, new.supplier_registration_extracted,
            new.account_number_extracted, new.statement_date, new.period_from, new.period_to, new.currency_code,
            new.opening_balance, new.closing_balance, new.printed_total_debits, new.printed_total_credits,
            new.printed_ageing, new.page_count, new.validated_at, new.extraction_snapshot
          ) <> 0 then
      raise exception 'a new supplier statement must start Queued with no results' using errcode = '42501';
    end if;
    if not exists (
      select 1 from documents d
      where d.id = new.document_id and d.company_id = new.company_id
        and d.entity_type = 'Supplier' and d.category = 'Statement'
        and d.content_sha256 = new.content_sha256
    ) then
      raise exception 'the document is not a supplier statement stored for this company' using errcode = '42501';
    end if;
    new.uploaded_by := fn_session_actor_label();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if (new.id, new.company_id, new.document_id, new.content_sha256, new.uploaded_by, new.created_at)
     is distinct from (old.id, old.company_id, old.document_id, old.content_sha256, old.uploaded_by, old.created_at) then
    raise exception 'a statement''s identity cannot be changed' using errcode = '42501';
  end if;
  if old.status = 'Rejected' then
    raise exception 'this statement was rejected and can no longer be changed' using errcode = '42501';
  end if;

  if (new.source_type, new.extraction_method, new.status_reason, new.duplicate_of_statement_id,
      new.supplier_candidates, new.supplier_name_extracted, new.supplier_vat_extracted,
      new.supplier_registration_extracted, new.account_number_extracted, new.page_count,
      new.validation_status, new.validation_findings, new.validated_at,
      new.extraction_snapshot, new.warnings, new.manual_entry)
     is distinct from
     (old.source_type, old.extraction_method, old.status_reason, old.duplicate_of_statement_id,
      old.supplier_candidates, old.supplier_name_extracted, old.supplier_vat_extracted,
      old.supplier_registration_extracted, old.account_number_extracted, old.page_count,
      old.validation_status, old.validation_findings, old.validated_at,
      old.extraction_snapshot, old.warnings, old.manual_entry) then
    raise exception 'extraction, validation and duplicate results cannot be changed by a user' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if (new.supplier_id, new.supplier_match_tier, new.supplier_confirmed_at, new.statement_date, new.period_from,
        new.period_to, new.currency_code, new.opening_balance, new.closing_balance, new.printed_total_debits,
        new.printed_total_credits, new.printed_ageing, new.sign_convention)
       is distinct from
       (old.supplier_id, old.supplier_match_tier, old.supplier_confirmed_at, old.statement_date, old.period_from,
        old.period_to, old.currency_code, old.opening_balance, old.closing_balance, old.printed_total_debits,
        old.printed_total_credits, old.printed_ageing, old.sign_convention) then
      raise exception 'a status change cannot also edit the statement' using errcode = '42501';
    end if;

    if new.status = 'Rejected' then
      if not user_has_permission(new.company_id, 'Purchasing:Reject') then
        raise exception 'Purchasing:Reject is required to reject a supplier statement' using errcode = '42501';
      end if;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    if not user_has_permission(new.company_id, 'Purchasing:Edit') then
      raise exception 'Purchasing:Edit is required to change a supplier statement' using errcode = '42501';
    end if;

    if new.status = 'ManualEntry' then
      if old.status not in ('Queued', 'Failed') then
        raise exception 'only a queued or failed statement can be entered by hand (it is %)', old.status using errcode = '42501';
      end if;
      new.manual_entry := true;
      new.extraction_method := 'manual';
      new.validation_status := 'Pending';
      new.validated_at := null;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'NeedsReview' then
      if old.status = 'ManualEntry' then
        new.validation_status := 'Pending';
        new.validated_at := null;
      elsif old.status not in ('Ready', 'Reconciled') then
        raise exception 'status NeedsReview cannot be set by a user from %', old.status using errcode = '42501';
      end if;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    if new.status = 'Ready' then
      if old.status <> 'NeedsReview' then
        raise exception 'only a statement in review can be marked ready (it is %)', old.status using errcode = '42501';
      end if;
      if old.validation_status not in ('Pass', 'Review') then
        raise exception 'the statement must validate before it is ready (it is %)', old.validation_status using errcode = '42501';
      end if;
      if old.supplier_id is null or old.supplier_confirmed_at is null then
        raise exception 'a reviewer must confirm the supplier before the statement is ready' using errcode = '42501';
      end if;
      if not fn_supplier_statement_currency_supported(old.company_id, old.currency_code) then
        raise exception 'unsupported currency: a % statement cannot be reconciled in this company (manual review required)', old.currency_code
          using errcode = '42501';
      end if;
      if exists (select 1 from supplier_statement_lines l
                 where l.statement_id = old.id and not l.is_excluded and cardinality(l.unresolved_fields) > 0) then
        raise exception 'every unreadable value must be resolved before the statement is ready' using errcode = '42501';
      end if;
      new.updated_at := clock_timestamp();
      return new;
    end if;

    -- 'Reconciled' (and every processing state) is set by the server only.
    raise exception 'status % cannot be set by a user', new.status using errcode = '42501';
  end if;

  if (new.supplier_id, new.supplier_match_tier, new.supplier_confirmed_at, new.supplier_confirmed_by,
      new.statement_date, new.period_from, new.period_to, new.currency_code, new.opening_balance,
      new.closing_balance, new.printed_total_debits, new.printed_total_credits, new.printed_ageing, new.sign_convention)
     is not distinct from
     (old.supplier_id, old.supplier_match_tier, old.supplier_confirmed_at, old.supplier_confirmed_by,
      old.statement_date, old.period_from, old.period_to, old.currency_code, old.opening_balance,
      old.closing_balance, old.printed_total_debits, old.printed_total_credits, old.printed_ageing, old.sign_convention) then
    return new;
  end if;

  if not user_has_permission(new.company_id, 'Purchasing:Edit') then
    raise exception 'Purchasing:Edit is required to correct a supplier statement' using errcode = '42501';
  end if;
  if old.status not in ('NeedsReview', 'ManualEntry') then
    raise exception 'only a statement in review or manual entry can be changed (it is %)', old.status using errcode = '42501';
  end if;

  if new.supplier_id is distinct from old.supplier_id then
    if new.supplier_id is not null
       and not exists (select 1 from ae_suppliers s where s.id = new.supplier_id and s.company_id = new.company_id) then
      raise exception 'the supplier does not belong to this company' using errcode = '42501';
    end if;
    new.supplier_match_tier := case when new.supplier_id is null then null else 'manual' end;
  elsif new.supplier_match_tier is distinct from old.supplier_match_tier then
    raise exception 'the supplier match tier is recorded by the system' using errcode = '42501';
  end if;

  if new.supplier_confirmed_at is not null
     and new.supplier_confirmed_at is distinct from old.supplier_confirmed_at then
    if new.supplier_id is null then
      raise exception 'there is no supplier to confirm' using errcode = '42501';
    end if;
    new.supplier_confirmed_by := fn_session_actor_label();
    new.supplier_confirmed_at := now();
  elsif new.supplier_id is distinct from old.supplier_id then
    new.supplier_confirmed_by := null;
    new.supplier_confirmed_at := null;
  elsif new.supplier_confirmed_at is null then
    new.supplier_confirmed_by := null;
  elsif new.supplier_confirmed_by is distinct from old.supplier_confirmed_by
        or new.supplier_confirmed_at is distinct from old.supplier_confirmed_at then
    raise exception 'a confirmation is recorded by the system' using errcode = '42501';
  end if;

  if (new.statement_date, new.period_from, new.period_to, new.currency_code, new.opening_balance,
      new.closing_balance, new.printed_total_debits, new.printed_total_credits, new.printed_ageing, new.sign_convention)
     is distinct from
     (old.statement_date, old.period_from, old.period_to, old.currency_code, old.opening_balance,
      old.closing_balance, old.printed_total_debits, old.printed_total_credits, old.printed_ageing, old.sign_convention) then
    new.validation_status := 'Pending';
    new.validated_at := null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke execute on function fn_supplier_statement_guard() from public, anon, authenticated, service_role;

alter table supplier_statement_reconciliations drop constraint if exists supplier_statement_reconciliations_basis_check;
alter table supplier_statement_reconciliations add constraint supplier_statement_reconciliations_basis_check
  check (basis = 'supplier-ledger-document-date');
comment on column supplier_statement_reconciliations.statement_closing is null;
comment on column supplier_statement_reconciliations.precisia_balance_at is null;

create or replace function fn_supplier_statement_reconciliation_insert_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  s supplier_statements;
begin
  select * into s from supplier_statements where id = new.statement_id;
  if not found or s.company_id is distinct from new.company_id then
    raise exception 'the statement does not belong to this company' using errcode = '42501';
  end if;
  if s.status not in ('Ready', 'Reconciled') then
    raise exception 'only a ready statement can be reconciled (it is %)', s.status using errcode = '42501';
  end if;
  if s.supplier_id is null or s.supplier_confirmed_at is null or s.supplier_id is distinct from new.supplier_id then
    raise exception 'a reconciliation is only run against the CONFIRMED supplier' using errcode = '42501';
  end if;
  if not fn_supplier_statement_currency_supported(s.company_id, s.currency_code) then
    raise exception 'unsupported currency: this statement cannot be reconciled (manual review required)' using errcode = '42501';
  end if;
  if s.closing_balance is distinct from new.statement_closing or s.statement_date is distinct from new.as_at_date then
    raise exception 'the run must use the statement''s own closing balance and date' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function fn_supplier_statement_reconciliation_insert_guard() from public, anon, authenticated, service_role;

alter table supplier_statement_reconciliation_items drop constraint if exists supplier_statement_reconciliation_items_category_check;
alter table supplier_statement_reconciliation_items add constraint supplier_statement_reconciliation_items_category_check check (category in (
  'Matched', 'Amount Difference', 'Missing in PRECISIA', 'Missing on Statement', 'Potential Duplicate',
  'Credit Note', 'Payment', 'Unclassified', 'Opening Balance Difference'));

alter table supplier_statement_reconciliation_items drop constraint if exists supplier_statement_reconciliation_items_match_tier_check;
alter table supplier_statement_reconciliation_items add constraint supplier_statement_reconciliation_items_match_tier_check
  check (match_tier in ('manual', 'exact', 'normalised', 'payment-evidence'));

commit;
