import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { reopenFinancialYear, setLockDate, ValidationError } from "@/server/services/financial-period-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; financialYearId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, financialYearId } = await params;
  const id = Number(financialYearId);
  const body = await request.json();

  const check = await requirePermission(companyId, "ManageFinancialYears");
  if (!check.ok) return check.response;

  try {
    if (body.action === "lock") {
      const financialYear = await setLockDate(companyId, id, body.lockDate ?? null);
      return NextResponse.json({ financialYear });
    }
    if (body.action === "reopen") {
      const financialYear = await reopenFinancialYear(companyId, id);
      return NextResponse.json({ financialYear });
    }
    return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
