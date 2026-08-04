/**
 * Product Review Board — Phase 4, Internal VYRON Platform Integrations.
 *
 * "Do not build the integrations now. Only create the architecture
 * required so that the integrations can be plugged in later without
 * redesigning VYRON FINANCE." This directory is that architecture and
 * nothing more: versioned business-event contract types, and pure
 * functions that map a contract event to the existing Posting Rules
 * engine's `event_type` (see `general-ledger/types.ts`, migration
 * 0007). No transport, no HTTP route, no webhook receiver, no sync
 * logic, no seeded/mock event data exists anywhere in this directory —
 * those would be the live integration itself, which is explicitly out
 * of scope until a real VYRON COST / VYRON CORE API exists to call.
 *
 * Why this shape satisfies "no database coupling, business events
 * only": VYRON FINANCE must never read another VYRON application's
 * database directly (Product Review Board, Phase 4). A contract type
 * is the one artefact that lets a future integration be *built* against
 * a stable shape without VYRON FINANCE depending on VYRON COST/CORE's
 * internal schema — the same reason an API contract, not a shared
 * table, is the boundary between any two independently-deployable
 * applications.
 *
 * Why event_type stays a free-text column and needed no schema change:
 * `posting_rules.event_type` (migration 0007) was never constrained to
 * an enum — every existing event type (Sales Invoice, Goods Received,
 * ...) is just a row a company can create through the real Posting
 * Rules CRUD UI/API that already ships. The mapping functions below
 * exist so a future integration handler has one authoritative event
 * name to look up a company's own configured rule by — not because the
 * engine needed extending.
 */

export type IntegrationSourceSystem = "VYRON_COST" | "VYRON_CORE";

/** The one envelope shape every VYRON COST / VYRON CORE business event
 * will arrive in, once a real connection exists. `eventVersion` is a
 * plain incrementing integer per `eventType` (not semver) — matches
 * this codebase's own migration-numbering convention of "a new
 * corrective step, never an edit to a shipped one": a breaking payload
 * change ships as `.v2`, the `.v1` type stays defined so an in-flight
 * integration is never silently broken by a payload shape change. */
export type IntegrationBusinessEvent<TEventType extends string, TPayload> = {
  eventId: string;
  eventType: TEventType;
  eventVersion: number;
  sourceSystem: IntegrationSourceSystem;
  companyId: string;
  occurredAt: string;
  payload: TPayload;
};
