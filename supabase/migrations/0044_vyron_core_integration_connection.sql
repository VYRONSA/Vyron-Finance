-- ---------------------------------------------------------------------
-- Product Review Board — Phase 4, Internal VYRON Platform Integrations.
-- VYRON CORE (Workforce Intelligence Platform) is a second peer VYRON
-- application, alongside VYRON COST, that VYRON FINANCE must be able to
-- receive real business events from later (Approved Timesheets, Labour
-- Cost Allocation, Payroll Journal Import, Leave Provisions, ...) —
-- see src/server/integrations/vyron-core-events.ts for the versioned
-- event contracts this connection status is for.
--
-- This migration only widens the existing, real `integration_connections`
-- registry (migration 0012) to recognise a second system name. No sync
-- logic, no seeded rows beyond the honest "Not Connected" default the
-- existing `ensureIntegrationConnection()` already creates on first
-- read — same pattern VYRON_COST already uses, not a new one.
-- ---------------------------------------------------------------------

alter table integration_connections drop constraint integration_connections_system_name_check;
alter table integration_connections add constraint integration_connections_system_name_check
  check (system_name in ('VYRON_COST', 'VYRON_CORE'));
