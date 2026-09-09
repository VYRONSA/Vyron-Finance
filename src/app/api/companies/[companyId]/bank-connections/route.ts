import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { initiateBankConnection, listBankConnections, ValidationError } from "@/server/bank-connectivity/bank-connectivity-service";
import type { BankEnvironment, BankProviderName } from "@/server/bank-connectivity/types";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Banking:View");
  if (!check.ok) return check.response;

  const connections = await listBankConnections(companyId);
  return NextResponse.json({ connections });
}

/**
 * "Connect Bank -> Select FNB -> VYRON generates secure state -> Redirect
 * to official FNB authorisation" (brief, Part 6). Returns the real
 * authorization URL for the browser to navigate to — this route never
 * performs the redirect itself, since the client needs to actually see
 * it leave VYRON for FNB's own domain.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Banking:Create");
  if (!check.ok) return check.response;

  const body = await request.json().catch(() => ({}));
  const provider = (body.provider as BankProviderName) ?? "FNB";
  const environment = (body.environment as BankEnvironment) ?? "production";
  const redirectAfter = typeof body.redirectAfter === "string" ? body.redirectAfter : null;

  try {
    const { connection, authorizationUrl } = await initiateBankConnection(companyId, provider, environment, new Date().toISOString(), redirectAfter);
    return NextResponse.json({ connection, authorizationUrl }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
