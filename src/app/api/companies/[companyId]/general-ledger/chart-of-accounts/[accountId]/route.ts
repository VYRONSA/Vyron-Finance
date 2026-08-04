import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { setChartOfAccountActive, updateChartOfAccount, ValidationError } from "@/server/services/chart-of-accounts-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; accountId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, accountId } = await params;
  const id = Number(accountId);
  const body = await request.json();

  const check = await requirePermission(companyId, "GeneralLedger:Edit");
  if (!check.ok) return check.response;

  try {
    if (typeof body.isActive === "boolean") {
      const account = await setChartOfAccountActive(companyId, id, body.isActive);
      return NextResponse.json({ account });
    }
    const account = await updateChartOfAccount(companyId, id, body);
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
