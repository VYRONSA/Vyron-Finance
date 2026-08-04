import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { generateReportingPackage, listReportingPackages } from "@/server/services/reporting-package-service";
import type { ReportingPackageType } from "@/server/disclosures/types";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const packages = await listReportingPackages(companyId);
  return NextResponse.json({ packages });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "GenerateFinancialStatements");
  if (!check.ok) return check.response;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  const { packageType, periodStart, periodEnd, financialYearStartDate, financialYearLabel } = body;

  if (!packageType || !periodStart || !periodEnd || !financialYearStartDate || !financialYearLabel) {
    return NextResponse.json({ error: "packageType, periodStart, periodEnd, financialYearStartDate, and financialYearLabel are required." }, { status: 400 });
  }

  const reportingPackage = await generateReportingPackage(companyId, packageType as ReportingPackageType, periodStart, periodEnd, financialYearStartDate, financialYearLabel, performedBy);
  return NextResponse.json({ reportingPackage }, { status: 201 });
}
