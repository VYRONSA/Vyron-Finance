import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listIntegrationConnections } from "@/server/services/integration-service";

/** Real connection-status only — no `sync` action exists here, since
 * there is no real VYRON COST API this codebase can call yet. See
 * `integration-service.ts`'s module docstring. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const connections = await listIntegrationConnections(companyId);
  return NextResponse.json({ connections });
}
