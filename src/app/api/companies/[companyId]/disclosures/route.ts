import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { generateDisclosureNotes, listDisclosureNotes } from "@/server/services/disclosure-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const periodStart = url.searchParams.get("periodStart");
  const periodEnd = url.searchParams.get("periodEnd");
  if (!periodStart || !periodEnd) return NextResponse.json({ error: "periodStart and periodEnd are required." }, { status: 400 });

  const notes = await listDisclosureNotes(companyId, periodStart, periodEnd);
  return NextResponse.json({ notes });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  const { periodStart, periodEnd, financialYearStartDate } = body;

  if (!periodStart || !periodEnd || !financialYearStartDate) {
    return NextResponse.json({ error: "periodStart, periodEnd, and financialYearStartDate are required." }, { status: 400 });
  }

  const check = await requirePermission(companyId, "Reports:Create");
  if (!check.ok) return check.response;

  const notes = await generateDisclosureNotes(companyId, periodStart, periodEnd, financialYearStartDate, performedBy);
  return NextResponse.json({ notes }, { status: 201 });
}
