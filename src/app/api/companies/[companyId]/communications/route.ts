import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { listCommunications, queueCommunication, NotFoundError, ValidationError } from "@/server/services/communication-service";
import { resolveCommunicationPermissionModule } from "@/server/communications/types";
import type { CommunicationChannel, CommunicationStatus } from "@/server/communications/types";

/** Every communication this company has ever queued, on every channel,
 * from every module — the ONE shared log, filterable by status/channel/
 * module/business object. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const communications = await listCommunications(companyId, {
    status: (url.searchParams.get("status") as CommunicationStatus) || undefined,
    channel: (url.searchParams.get("channel") as CommunicationChannel) || undefined,
    module: url.searchParams.get("module") || undefined,
    businessObjectType: url.searchParams.get("businessObjectType") || undefined,
    businessObjectId: url.searchParams.get("businessObjectId") ? Number(url.searchParams.get("businessObjectId")) : undefined,
  });
  return NextResponse.json({ communications });
}

/** The ONE entry point every module queues a communication through —
 * see `communication-service.ts::queueCommunication`. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  if (!body.module) return NextResponse.json({ error: "module is required." }, { status: 400 });

  const check = await requirePermission(companyId, `${resolveCommunicationPermissionModule(body.module)}:Create`);
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  try {
    const communication = await queueCommunication(companyId, { ...body, createdBy: performedBy });
    return NextResponse.json({ communication }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
