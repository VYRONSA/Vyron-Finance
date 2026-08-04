import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createVatTreatment, listVatTreatments, ValidationError } from "@/server/services/vat-treatment-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const vatTreatments = await listVatTreatments(companyId);
  return NextResponse.json({ vatTreatments });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "ManageVAT");
  if (!check.ok) return check.response;

  try {
    const vatTreatment = await createVatTreatment(companyId, body);
    return NextResponse.json({ vatTreatment }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
