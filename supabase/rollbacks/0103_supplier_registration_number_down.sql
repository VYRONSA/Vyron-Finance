-- Down script for 0103_supplier_registration_number.sql.
--
-- Drops the column and everything captured in it. Safe in the sense that
-- nothing else depends on it (no index, constraint, view, function or
-- posting path references `ae_suppliers.registration_number`), but the
-- captured registration numbers are lost — export them first if any have
-- been entered.

alter table ae_suppliers
  drop column if exists registration_number;
