import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { recordPermanentIgnore, type DuplicateEntityType } from "@/server/services/duplicate-detection-service";

/** Permanent Ignore Rule — persisted, and filtered out of every future
 * duplicate-detection run for this exact record. See
 * `duplicate-detection-service.ts::recordPermanentIgnore`. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Matching:Edit");
  if (!check.ok) return check.response;

  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  await recordPermanentIgnore(companyId, body.entityType as DuplicateEntityType, Number(body.relatedId), String(body.reason ?? ""), performedBy);
  return NextResponse.json({ ok: true }, { status: 201 });
}
