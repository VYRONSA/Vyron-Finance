import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getFinancialIntelligence } from "@/server/services/financial-intelligence-service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaultDateFrom(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 90);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const dateFromParam = url.searchParams.get("dateFrom");
  const dateToParam = url.searchParams.get("dateTo");

  if ((dateFromParam && !DATE_RE.test(dateFromParam)) || (dateToParam && !DATE_RE.test(dateToParam))) {
    return NextResponse.json({ error: "dateFrom/dateTo must be YYYY-MM-DD." }, { status: 400 });
  }

  const dateFrom = dateFromParam ?? defaultDateFrom();
  const dateTo = dateToParam ?? new Date().toISOString().slice(0, 10);

  const report = await getFinancialIntelligence(companyId, dateFrom, dateTo);
  return NextResponse.json({ report });
}
