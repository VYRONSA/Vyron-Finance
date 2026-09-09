import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createFinancialYear, listFinancialYears, ValidationError } from "@/server/services/financial-year-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const financialYears = await listFinancialYears(companyId);
  return NextResponse.json({ financialYears });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "ManageFinancialYears");
  if (!check.ok) return check.response;

  try {
    const financialYear = await createFinancialYear(companyId, body);
    return NextResponse.json({ financialYear }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
