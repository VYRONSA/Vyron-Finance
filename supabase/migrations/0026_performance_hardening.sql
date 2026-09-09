-- RC1 Phase 3 — Performance Hardening. The Production Readiness Report
-- named 10 repositories running unbounded queries (`.select("*")` with
-- no `.limit()`); each now has a real cap (see the matching
-- `LIST_CAP = 10_000` added to every one of those 10 repository files).
-- A `company_id`-only index already existed on all 10 underlying tables
-- (confirmed by grepping every prior migration, not assumed) — this
-- migration adds the missing COMPOSITE index each capped, ordered query
-- actually needs: `(company_id, <sort column>)`. Without it, Postgres
-- can use the existing single-column `company_id` index to find the
-- company's rows but still has to sort them all in memory before
-- applying `LIMIT`; with it, the same query is satisfied by a single
-- index scan in already-sorted order — the real, measurable performance
-- difference "Indexes" in the RC1 directive is asking for, not just a
-- capped result set.
--
-- `if not exists` throughout since every underlying `company_id` index
-- already exists and this migration only ADDS the second column — a
-- pure, safe, additive change with no behavior change to any existing
-- query, index creation is fully non-destructive.

create index if not exists customers_company_id_name_idx on customers (company_id, name);
create index if not exists merchants_company_id_name_idx on merchants (company_id, name);
create index if not exists stock_items_company_id_stock_code_idx on stock_items (company_id, stock_code);
create index if not exists ae_suppliers_company_id_name_idx on ae_suppliers (company_id, name);
create index if not exists ae_imported_bills_company_id_invoice_date_idx on ae_imported_bills (company_id, invoice_date desc);
create index if not exists sales_orders_company_id_order_date_idx on sales_orders (company_id, order_date desc);
create index if not exists purchase_orders_company_id_order_date_idx on purchase_orders (company_id, order_date desc);
create index if not exists sales_quotations_company_id_quotation_date_idx on sales_quotations (company_id, quotation_date desc);
create index if not exists supplier_payments_company_id_payment_date_idx on supplier_payments (company_id, payment_date desc);
create index if not exists customer_receipts_company_id_receipt_date_idx on customer_receipts (company_id, receipt_date desc);

-- The RBAC platform (0025) added 4 new company-scoped tables whose own
-- lookups (`getUserRoleAssignment`, `listRolesForCompany`,
-- `listAssignmentsForCompany`, and every `user_has_permission()` call —
-- which runs on the hot path of every single permission-gated request)
-- had no dedicated index beyond the primary key. These are exactly the
-- kind of high-frequency point lookups that most benefit from a real
-- index, not an afterthought.
create index if not exists permission_roles_company_id_idx on permission_roles (company_id);
create index if not exists role_permissions_role_id_idx on role_permissions (role_id);
create index if not exists role_approval_limits_role_id_idx on role_approval_limits (role_id);
create index if not exists user_role_assignments_user_company_idx on user_role_assignments (user_id, company_id);
create index if not exists permission_audit_log_company_id_idx on permission_audit_log (company_id);
