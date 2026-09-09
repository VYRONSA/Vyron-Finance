-- Finding #037 (Master Implementation Tracker, Programme 3 / Epic E6):
-- suppliers had no uniqueness constraint on supplier_code at all, unlike
-- customers.customer_code (see 0008_customer_management.sql). The
-- application layer now rejects a duplicate code before writing
-- (supplier-management-service.ts::updateSupplier), but the DB
-- constraint is real defense-in-depth against any other write path.
-- Partial index (not a plain unique constraint) so multiple suppliers
-- that were never assigned a code (supplier_code = '') don't collide.

create unique index ae_suppliers_company_supplier_code_uidx
  on ae_suppliers (company_id, supplier_code)
  where supplier_code <> '';
