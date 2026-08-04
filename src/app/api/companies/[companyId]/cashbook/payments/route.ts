import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { captureCashbookPayment, ValidationError } from "@/server/services/cashbook-service";
import { requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Cashbook:Create");
  if (!check.ok) return check.response;

  try {
    const transaction = await captureCashbookPayment(companyId, body);
    return NextResponse.json({ transaction }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
