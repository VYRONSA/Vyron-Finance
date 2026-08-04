import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { closeFinancialYear, setCurrentFinancialYear } from "@/server/services/financial-year-service";
import { requirePermission } from "@/server/services/permission-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ companyId: string; financialYearId: string }> },
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, financialYearId } = await params;
  const body = await request.json();
  const id = Number(financialYearId);

  const check = await requirePermission(companyId, "ManageFinancialYears");
  if (!check.ok) return check.response;

  if (body.action === "set-current") {
    const financialYear = await setCurrentFinancialYear(companyId, id);
    return NextResponse.json({ financialYear });
  }
  if (body.action === "close") {
    const financialYear = await closeFinancialYear(companyId, id);
    return NextResponse.json({ financialYear });
  }
  return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
}
