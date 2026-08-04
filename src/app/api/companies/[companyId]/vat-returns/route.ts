import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { generateVatReturn, listVatReturns, ValidationError } from "@/server/services/vat-return-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const vatReturns = await listVatReturns(companyId);
  return NextResponse.json({ vatReturns });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "ManageVAT");
  if (!check.ok) return check.response;

  try {
    const vatReturn = await generateVatReturn(companyId, body.periodStart, body.periodEnd, performedBy);
    return NextResponse.json({ vatReturn }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
