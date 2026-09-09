-- Finding #057 — a Draft or Submitted Purchase Requisition could not be
-- withdrawn/cancelled; the status enum had no Cancelled value at all,
-- mirroring every sibling document (Purchase Order, GRN, Sales Order).
alter table purchase_requisitions drop constraint purchase_requisitions_status_check;
alter table purchase_requisitions add constraint purchase_requisitions_status_check
  check (status in ('Draft', 'Submitted', 'Approved', 'Rejected', 'Converted', 'Cancelled'));
