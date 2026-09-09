-- RC2 Phase 2 — Database Optimisation. Evidence-based, not premature:
-- every repository function in this codebase filters company-scoped
-- tables with `.eq("company_id", companyId)` (the universal pattern
-- established since RC1 Phase 1), and RLS's `user_can_access_company()`
-- resolves per-row on the same column. A systematic scan of all 119
-- tables' indexes (`pg_index` cross-referenced against every column
-- named `company_id`) found these 13 tables where `company_id` is not
-- a leading column of any index — meaning both the application's own
-- filter and RLS's check force a sequential scan at scale. 3 of the 13
-- (`ae_allocation_history`, `ae_match_history`,
-- `ae_transaction_review_history`) were already flagged as disclosed,
-- deferred technical debt in RC1 Phase 7's own repository audit — this
-- closes that specific gap along with 10 more found the same way.
--
-- Deliberately NOT indexing the other ~83 columns the raw foreign-key
-- scan also flagged (any FK column with no leading index): cross-
-- referencing against actual `.eq(...)` usage in the repository layer
-- found most have no direct query pattern filtering by that column
-- alone (they exist for referential integrity, not lookups) — indexing
-- all of them would be exactly the "premature optimisation" this phase
-- explicitly rules out. `company_id` is the one column proven, by the
-- universal repository pattern itself, to be queried directly on every
-- one of these tables.
create index if not exists ae_allocation_history_company_id_idx on ae_allocation_history (company_id);
create index if not exists ae_match_history_company_id_idx on ae_match_history (company_id);
create index if not exists ae_transaction_review_history_company_id_idx on ae_transaction_review_history (company_id);
create index if not exists asset_lifecycle_events_company_id_idx on asset_lifecycle_events (company_id);
create index if not exists audit_areas_company_id_idx on audit_areas (company_id);
create index if not exists audit_programme_steps_company_id_idx on audit_programme_steps (company_id);
create index if not exists audit_risk_register_company_id_idx on audit_risk_register (company_id);
create index if not exists audit_team_assignments_company_id_idx on audit_team_assignments (company_id);
create index if not exists audit_working_papers_company_id_idx on audit_working_papers (company_id);
create index if not exists bank_transaction_splits_company_id_idx on bank_transaction_splits (company_id);
create index if not exists depreciation_runs_company_id_idx on depreciation_runs (company_id);
create index if not exists stock_cost_layers_company_id_idx on stock_cost_layers (company_id);
-- user_role_assignments already has a (user_id, company_id) composite
-- (0025) which cannot serve a company_id-only filter efficiently
-- (company_id isn't the leading column) — `listAssignmentsForCompany()`
-- filters by company_id alone, the exact gap this closes.
create index if not exists user_role_assignments_company_id_idx on user_role_assignments (company_id);
