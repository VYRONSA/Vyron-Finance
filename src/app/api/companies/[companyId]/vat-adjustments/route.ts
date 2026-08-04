import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { createVatAdjustment, listVatAdjustments, ValidationError } from "@/server/services/vat-adjustment-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const vatAdjustments = await listVatAdjustments(companyId);
  return NextResponse.json({ vatAdjustments });
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
    const vatAdjustment = await createVatAdjustment(companyId, { ...body, createdBy: performedBy });
    return NextResponse.json({ vatAdjustment }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
