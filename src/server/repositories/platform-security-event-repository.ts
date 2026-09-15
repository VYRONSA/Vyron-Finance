/**
 * Platform-level security events raised where no signed-in session exists
 * to write them with — the platform bootstrap route (P0 security
 * remediation). Same `system_events` table and shape as the Operations
 * Centre's `recordSystemEvent` (`operations-repository.ts`), platform scope
 * (`company_id` null), written and read with the service-role client.
 *
 * Kept apart from `operations-repository.ts` on purpose: only the bootstrap
 * guard needs the service-role client here, so nothing else that records
 * or lists operations events has it in its module graph.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { NewSystemEvent } from "@/server/repositories/operations-repository";
import type { SystemEventType } from "@/server/operations/types";

export async function recordPlatformSecurityEvent(input: Omit<NewSystemEvent, "companyId">): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("system_events").insert({
    company_id: null,
    event_type: input.eventType,
    severity: input.severity ?? "warning",
    actor: input.actor ?? null,
    detail: input.detail ?? "",
    metadata: input.metadata ?? {},
  });
  if (error) throw error;
}

/** How many platform-level events of a type (optionally with matching
 * metadata fields) were recorded since `sinceIso` — used by the bootstrap
 * rate limiters, so the limits hold across serverless instances. */
export async function countRecentPlatformEvents(eventType: SystemEventType, sinceIso: string, metadataEquals: Record<string, string> = {}): Promise<number> {
  const admin = createAdminClient();
  let query = admin.from("system_events").select("id", { count: "exact", head: true }).is("company_id", null).eq("event_type", eventType).gte("created_at", sinceIso);
  for (const [key, value] of Object.entries(metadataEquals)) query = query.eq(`metadata->>${key}`, value);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}
