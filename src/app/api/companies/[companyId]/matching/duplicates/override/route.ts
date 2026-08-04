import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { recordManualOverride, type DuplicateEntityType } from "@/server/services/duplicate-detection-service";

/** Manual Override — a persisted audit note; does not suppress future
 * detection. See `duplicate-detection-service.ts::recordManualOverride`. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Matching:Edit");
  if (!check.ok) return check.response;

  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  await recordManualOverride(companyId, body.entityType as DuplicateEntityType, Number(body.relatedId), String(body.reason ?? ""), performedBy);
  return NextResponse.json({ ok: true }, { status: 201 });
}
