/**
 * Integration Centre — real connection-status tracking, no fabricated
 * synchronisation. Per the Product Review Board's directive: VYRON
 * FINANCE only ever builds the integration *layer* for its peer VYRON
 * platform applications — manufacturing/costing belongs to VYRON COST,
 * workforce/HR belongs to VYRON CORE (see
 * `src/server/integrations/event-contract.ts` for the versioned
 * business-event contracts each will send once a real connection
 * exists). There is no real API for either system this codebase can
 * call yet, so `syncNow` deliberately does not exist here — a "Connect"/
 * "Sync" action that pretended to succeed would be exactly the kind of
 * fabrication the platform's own "no module may invent information"
 * principle forbids. This service only ever reports the honest,
 * persisted status ("Not Connected" until a real integration exists),
 * giving a future module a real place to write `last_synced_at` once
 * one does.
 */

import * as repo from "@/server/repositories/integration-connection-repository";
import type { IntegrationConnection } from "@/server/inventory/types";

const SYSTEMS: IntegrationConnection["systemName"][] = ["VYRON_COST", "VYRON_CORE"];

export async function listIntegrationConnections(companyId: string): Promise<IntegrationConnection[]> {
  const existing = await repo.listIntegrationConnections(companyId);
  const missing = SYSTEMS.filter((system) => !existing.some((c) => c.systemName === system));
  const created = await Promise.all(missing.map((system) => repo.ensureIntegrationConnection(companyId, system)));
  return [...existing, ...created];
}
