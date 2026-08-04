import { NextResponse } from "next/server";
import { requireSession, getCurrentUserId } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listCompaniesForUser } from "@/server/services/company-service";
import { buildCompanyOperationsSnapshot } from "@/server/services/operations-service";

/** The Operations Centre's cross-company view — spans exactly the
 * companies the signed-in user (a) belongs to AND (b) holds
 * SystemAdministration in — the same real membership scope
 * `/platform`'s own "My Companies" list already uses, further narrowed
 * to an administrative permission since operational data is sensitive.
 * NOT a fabricated "every tenant on the platform" view — true cross-
 * organisation visibility would need a platform-role resolution layer
 * that does not exist anywhere in this codebase yet (confirmed by RC1
 * Phase 6's own research). The permission filter is applied here, not
 * inside `operations-service.ts`, to avoid a circular import
 * (`permission-service.ts` itself now depends on `operations-service.ts`
 * for its own denial logging). */
export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const userId = await getCurrentUserId();
  const companies = await listCompaniesForUser(userId);
  const nowIso = new Date().toISOString();

  const allowed = await Promise.all(
    companies.map(async (c) => ((await requirePermission(c.id, "SystemAdministration")).ok ? c : null)),
  );

  const snapshots = await Promise.all(
    allowed.filter((c) => c !== null).map((c) => buildCompanyOperationsSnapshot(c.id, nowIso)),
  );
  return NextResponse.json({ snapshots });
}
