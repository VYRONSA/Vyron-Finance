-- Finding #118 — the Document Platform (0027) was never wired into the
-- Sales/Purchasing transactional document types, even though everything
-- below is generic and already fully built. Adds the 8 new entity types
-- to both the check constraint and document_permission_module(), kept
-- in sync per that migration's own comment.
alter table documents drop constraint documents_entity_type_check;
alter table documents add constraint documents_entity_type_check
  check (entity_type in (
    'Customer', 'Supplier', 'Inventory', 'Asset', 'Journal', 'BankStatement', 'AuditEvidence', 'FinancialStatement',
    'Quotation', 'SalesOrder', 'Delivery', 'SalesInvoice', 'PurchaseRequisition', 'PurchaseOrder', 'GoodsReceivedNote', 'SupplierBill'
  ));

create or replace function document_permission_module(target_entity_type text)
returns text
language sql
immutable
as $$
  select case target_entity_type
    when 'Customer' then 'Sales'
    when 'Supplier' then 'Purchasing'
    when 'Inventory' then 'Inventory'
    when 'Asset' then 'Assets'
    when 'Journal' then 'GeneralLedger'
    when 'BankStatement' then 'Banking'
    when 'AuditEvidence' then 'Auditor'
    when 'FinancialStatement' then 'Reports'
    when 'Quotation' then 'Sales'
    when 'SalesOrder' then 'Sales'
    when 'Delivery' then 'Sales'
    when 'SalesInvoice' then 'Sales'
    when 'PurchaseRequisition' then 'Purchasing'
    when 'PurchaseOrder' then 'Purchasing'
    when 'GoodsReceivedNote' then 'Purchasing'
    when 'SupplierBill' then 'Purchasing'
  end;
$$;
