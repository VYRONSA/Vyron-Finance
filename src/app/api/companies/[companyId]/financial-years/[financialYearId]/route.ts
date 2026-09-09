import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { closeFinancialYear, setCurrentFinancialYear, ValidationError } from "@/server/services/financial-year-service";
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

  try {
    if (body.action === "set-current") {
      const financialYear = await setCurrentFinancialYear(companyId, id);
      return NextResponse.json({ financialYear });
    }
    if (body.action === "close") {
      const financialYear = await closeFinancialYear(companyId, id);
      return NextResponse.json({ financialYear });
    }
    return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
  } catch (error) {
    // Master Implementation Tracker — Epic E1, Finding #011.
    // `closeFinancialYear` now validates before closing — this route
    // previously had no error handling at all, so that validation's
    // message would never have reached the user.
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
