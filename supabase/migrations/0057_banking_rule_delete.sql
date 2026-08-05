-- Pilot Review Round 1 (Board's Phase 8, "Banking Rule Management") —
-- "Delete" was entirely missing from every layer (repository, service,
-- API, UI) before this. Implemented as a soft delete, not a hard
-- `delete from banking_rules` — this codebase's own established
-- philosophy (Customers/Suppliers/Bank Accounts all stay soft-toggled,
-- never hard-deleted) plus a concrete reason specific to rules: hard-
-- deleting would cascade away `banking_rule_versions` and
-- `banking_rule_applications`, destroying exactly the "Usage Count" /
-- "Last Applied" / "Rule History" audit trail the same Phase 8 request
-- also asks to keep. A rule already has `is_active` (Enable/Disable,
-- meaning "temporarily won't fire, still listed") — `is_deleted` is a
-- genuinely separate concept ("removed from the management list
-- entirely"), not a re-use of the same flag, so the two operations stay
-- distinguishable exactly as the directive asks for both.
alter table banking_rules add column is_deleted boolean not null default false;
create index banking_rules_company_id_not_deleted_idx on banking_rules (company_id) where not is_deleted;
