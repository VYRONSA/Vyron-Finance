import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { deleteBudget } from "@/server/services/budget-service";
import { requirePermission } from "@/server/services/permission-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; budgetId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, budgetId } = await params;

  const check = await requirePermission(companyId, "Settings:Edit");
  if (!check.ok) return check.response;

  await deleteBudget(companyId, Number(budgetId));
  return NextResponse.json({ ok: true });
}
