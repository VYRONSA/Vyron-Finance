-- RC1 Phase 5.1 — Commercial Communication Integration. Extends the
-- Phase 5 Communication Platform (0028) with document attachments, a
-- fixed template category taxonomy, and the seeded templates every
-- named commercial business object's "Send" action renders with. No
-- second communication system, no new attachment storage — attachments
-- reference the SAME `documents` table the Phase 4 Document Platform
-- already owns.

create table communication_attachments (
  id bigint generated always as identity primary key,
  communication_id bigint not null references communications (id) on delete cascade,
  document_id bigint not null references documents (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (communication_id, document_id)
);

create index communication_attachments_communication_idx on communication_attachments (communication_id);
create index communication_attachments_document_idx on communication_attachments (document_id);

alter table communication_attachments enable row level security;
create policy "members can access their company's communication attachments" on communication_attachments for all using (
  exists (select 1 from communications c where c.id = communication_id and user_can_access_company(c.company_id))
);

-- Template categories — a fixed taxonomy so template management stays
-- organised as the catalog grows. The 3 templates seeded in 0028 used
-- free-text categories ('Reminder'/'Statement'); reclassify them onto
-- the new fixed list before the CHECK constraint would otherwise reject
-- them.
update communication_templates set category = 'Customers' where code in ('PaymentReminder', 'CustomerStatement');
update communication_templates set category = 'Suppliers' where code = 'SupplierStatement';

alter table communication_templates add constraint communication_templates_category_check
  check (category in ('Sales', 'Purchasing', 'Customers', 'Suppliers', 'Finance', 'Audit', 'Marketing', 'Internal', 'Legal'));

/** Re-seeds `seed_company_communication_defaults()` to be per-template
 * idempotent (`on conflict ... do nothing`) rather than the original
 * 0028 all-or-nothing "skip if the company already has ANY template"
 * guard — a company that already has the original 3 templates from
 * Phase 5 needs the new Phase 5.1 templates added, not skipped. `create
 * or replace` is safe here since the function has no callers mid-
 * transaction and its net effect (seed what's missing) is unchanged for
 * a company seeing it for the first time. */
create or replace function seed_company_communication_defaults(target_company_id uuid)
returns void
language plpgsql
as $$
declare
  approval_def_id bigint;
begin
  select id into approval_def_id from workflow_definitions
    where company_id = target_company_id and name = 'Communication Approval' limit 1;
  if approval_def_id is null then
    insert into workflow_definitions (company_id, workflow_type, name, steps)
    values (target_company_id, 'Approval', 'Communication Approval', '[{"stepOrder":0,"name":"Finance Review","approverLabel":"Financial Manager"}]')
    returning id into approval_def_id;
  end if;

  insert into communication_templates (company_id, code, name, channel, category, subject_template, body_template, variables_schema, requires_approval, approval_workflow_definition_id)
  values
    (target_company_id, 'PaymentReminder', 'Payment Reminder', 'Email', 'Customers',
     'Payment Reminder — {{recipientName}}',
     'Dear {{recipientName}},{{#if message}}\n\n{{message}}{{/if}}\n\nThis is a reminder regarding your account with us.\n\nRegards,\n{{companyName}}',
     '[{"name":"recipientName","description":"Customer or supplier name"},{"name":"message","description":"Optional custom message"},{"name":"companyName","description":"Sending company name"}]',
     true, approval_def_id),
    (target_company_id, 'CustomerStatement', 'Customer Statement', 'Email', 'Customers',
     'Statement of Account — {{customerName}}',
     'Dear {{customerName}},\n\nPlease find your statement summary below.\n\nOutstanding balance: {{outstandingBalance}}\nOverdue: {{overdueAmount}}\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"outstandingBalance","description":"Total outstanding, formatted"},{"name":"overdueAmount","description":"Total overdue, formatted"},{"name":"companyName","description":"Sending company name"}]',
     true, approval_def_id),
    (target_company_id, 'SupplierStatement', 'Supplier Statement', 'Email', 'Suppliers',
     'Statement of Account — {{supplierName}}',
     'Dear {{supplierName}},\n\nPlease find your statement summary below.\n\nOutstanding balance: {{outstandingBalance}}\n\nRegards,\n{{companyName}}',
     '[{"name":"supplierName","description":"Supplier name"},{"name":"outstandingBalance","description":"Total outstanding, formatted"},{"name":"companyName","description":"Sending company name"}]',
     false, null),

    (target_company_id, 'WelcomeEmail', 'Customer Welcome Email', 'Email', 'Customers',
     'Welcome, {{customerName}}',
     'Dear {{customerName}},\n\nWelcome — your account with {{companyName}} is now set up (customer code {{customerCode}}).\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"customerCode","description":"Assigned customer code"},{"name":"companyName","description":"Sending company name"}]',
     false, null),
    (target_company_id, 'AccountSuspensionNotice', 'Customer Account Suspension Notice', 'Email', 'Customers',
     'Account Suspended — {{customerName}}',
     'Dear {{customerName}},\n\nYour account with {{companyName}} has been suspended. Please contact us to resolve this.\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"companyName","description":"Sending company name"}]',
     false, null),

    (target_company_id, 'SupplierOnboarding', 'Supplier Onboarding', 'Email', 'Suppliers',
     'Welcome, {{supplierName}}',
     'Dear {{supplierName}},\n\nWelcome — you are now set up as a supplier with {{companyName}} (supplier code {{supplierCode}}).\n\nRegards,\n{{companyName}}',
     '[{"name":"supplierName","description":"Supplier name"},{"name":"supplierCode","description":"Assigned supplier code"},{"name":"companyName","description":"Sending company name"}]',
     false, null),
    (target_company_id, 'RemittanceAdvice', 'Remittance / Payment Advice', 'Email', 'Suppliers',
     'Remittance Advice — {{supplierName}}',
     'Dear {{supplierName}},\n\nA payment of {{amount}} was made to your account on {{paymentDate}} (reference {{reference}}).\n\nRegards,\n{{companyName}}',
     '[{"name":"supplierName","description":"Supplier name"},{"name":"amount","description":"Payment amount, formatted"},{"name":"paymentDate","description":"Payment date"},{"name":"reference","description":"Payment reference"},{"name":"companyName","description":"Sending company name"}]',
     false, null),

    (target_company_id, 'QuotationEmail', 'Quotation', 'Email', 'Sales',
     'Quotation {{quotationNumber}} from {{companyName}}',
     'Dear {{customerName}},\n\nPlease find quotation {{quotationNumber}} attached, total {{total}}, valid until {{expiryDate}}.\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"quotationNumber","description":"Quotation number"},{"name":"total","description":"Quotation total, formatted"},{"name":"expiryDate","description":"Expiry date"},{"name":"companyName","description":"Sending company name"}]',
     false, null),
    (target_company_id, 'SalesOrderConfirmation', 'Sales Order Confirmation', 'Email', 'Sales',
     'Order Confirmation {{orderNumber}}',
     'Dear {{customerName}},\n\nYour order {{orderNumber}} for {{total}} has been confirmed.\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"orderNumber","description":"Sales order number"},{"name":"total","description":"Order total, formatted"},{"name":"companyName","description":"Sending company name"}]',
     false, null),
    (target_company_id, 'DeliveryConfirmation', 'Delivery Confirmation', 'Email', 'Sales',
     'Delivery Confirmation — Order {{orderNumber}}',
     'Dear {{customerName}},\n\nYour order {{orderNumber}} has been dispatched/delivered.\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"orderNumber","description":"Sales order number"},{"name":"companyName","description":"Sending company name"}]',
     false, null),
    (target_company_id, 'InvoiceEmail', 'Sales Invoice', 'Email', 'Sales',
     'Invoice {{invoiceNumber}} from {{companyName}}',
     'Dear {{customerName}},\n\nPlease find invoice {{invoiceNumber}} attached, total {{total}}, due {{dueDate}}.\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"invoiceNumber","description":"Invoice number"},{"name":"total","description":"Invoice total, formatted"},{"name":"dueDate","description":"Due date"},{"name":"companyName","description":"Sending company name"}]',
     false, null),
    (target_company_id, 'CreditNoteEmail', 'Customer Credit Note', 'Email', 'Sales',
     'Credit Note {{invoiceNumber}} from {{companyName}}',
     'Dear {{customerName}},\n\nPlease find credit note {{invoiceNumber}} attached, total {{total}}.\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"invoiceNumber","description":"Credit note number"},{"name":"total","description":"Credit note total, formatted"},{"name":"companyName","description":"Sending company name"}]',
     true, approval_def_id),
    (target_company_id, 'DebitNoteEmail', 'Customer Debit Note', 'Email', 'Sales',
     'Debit Note {{invoiceNumber}} from {{companyName}}',
     'Dear {{customerName}},\n\nPlease find debit note {{invoiceNumber}} attached, total {{total}}.\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"invoiceNumber","description":"Debit note number"},{"name":"total","description":"Debit note total, formatted"},{"name":"companyName","description":"Sending company name"}]',
     false, null),
    (target_company_id, 'ReceiptEmail', 'Customer Receipt', 'Email', 'Sales',
     'Receipt {{receiptNumber}} from {{companyName}}',
     'Dear {{customerName}},\n\nThank you — we have received your payment of {{amount}} (receipt {{receiptNumber}}).\n\nRegards,\n{{companyName}}',
     '[{"name":"customerName","description":"Customer name"},{"name":"receiptNumber","description":"Receipt number"},{"name":"amount","description":"Amount received, formatted"},{"name":"companyName","description":"Sending company name"}]',
     false, null),

    (target_company_id, 'RequisitionNotification', 'Purchase Requisition Submitted', 'InApp', 'Purchasing',
     null,
     'Requisition {{requisitionNumber}} submitted by {{requestedBy}} for {{total}} is awaiting review.',
     '[{"name":"requisitionNumber","description":"Requisition number"},{"name":"requestedBy","description":"Requestor name"},{"name":"total","description":"Requisition total, formatted"}]',
     false, null),
    (target_company_id, 'PurchaseOrderEmail', 'Purchase Order', 'Email', 'Purchasing',
     'Purchase Order {{orderNumber}} from {{companyName}}',
     'Dear {{supplierName}},\n\nPlease find purchase order {{orderNumber}} attached, total {{total}}.\n\nRegards,\n{{companyName}}',
     '[{"name":"supplierName","description":"Supplier name"},{"name":"orderNumber","description":"Purchase order number"},{"name":"total","description":"Order total, formatted"},{"name":"companyName","description":"Sending company name"}]',
     false, null),
    (target_company_id, 'GoodsReceiptConfirmation', 'Goods Receipt Confirmation', 'Email', 'Purchasing',
     'Goods Receipt Confirmation — {{grnNumber}}',
     'Dear {{supplierName}},\n\nWe confirm receipt of goods against {{grnNumber}}.\n\nRegards,\n{{companyName}}',
     '[{"name":"supplierName","description":"Supplier name"},{"name":"grnNumber","description":"Goods received note number"},{"name":"companyName","description":"Sending company name"}]',
     false, null),

    (target_company_id, 'ManagementPackEmail', 'Management Pack', 'Email', 'Finance',
     'Management Pack — {{period}}',
     'Dear {{recipientName}},\n\nPlease find the Management Pack for {{period}} attached.\n\nRegards,\n{{companyName}}',
     '[{"name":"recipientName","description":"Recipient name"},{"name":"period","description":"Reporting period"},{"name":"companyName","description":"Sending company name"}]',
     true, approval_def_id),
    (target_company_id, 'BoardPackEmail', 'Board Pack', 'Email', 'Finance',
     'Board Pack — {{period}}',
     'Dear {{recipientName}},\n\nPlease find the Board Pack for {{period}} attached.\n\nRegards,\n{{companyName}}',
     '[{"name":"recipientName","description":"Recipient name"},{"name":"period","description":"Reporting period"},{"name":"companyName","description":"Sending company name"}]',
     true, approval_def_id)
  on conflict (company_id, code, channel) do nothing;

  if not exists (select 1 from automation_tasks where company_id = target_company_id and task_type = 'CommunicationQueue') then
    insert into automation_tasks (company_id, task_type, name, next_run_at)
    values (target_company_id, 'CommunicationQueue', 'Communication Queue Processor', now());
  end if;
end;
$$;

do $$
declare
  c record;
begin
  for c in select id from companies loop
    perform seed_company_communication_defaults(c.id);
  end loop;
end $$;
