import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { listBudgets, upsertBudget, ValidationError } from "@/server/services/budget-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const financialYearLabel = new URL(request.url).searchParams.get("financialYearLabel") ?? undefined;
  const budgets = await listBudgets(companyId, financialYearLabel);
  return NextResponse.json({ budgets });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "Settings:Create");
  if (!check.ok) return check.response;

  try {
    const budget = await upsertBudget(companyId, performedBy, body);
    return NextResponse.json({ budget }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
