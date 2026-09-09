import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getAccountActivity, getAccountYearComparison } from "@/server/services/account-activity-service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; accountId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, accountId } = await params;
  const url = new URL(request.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  if (!dateFrom || !DATE_RE.test(dateFrom) || !dateTo || !DATE_RE.test(dateTo)) {
    return NextResponse.json({ error: "dateFrom and dateTo are required, as YYYY-MM-DD." }, { status: 400 });
  }

  const id = Number(accountId);
  const [activity, yearComparison] = await Promise.all([
    getAccountActivity(companyId, id, dateFrom, dateTo),
    getAccountYearComparison(companyId, id, dateFrom, dateTo),
  ]);

  if (!activity) {
    return NextResponse.json({ error: `No account with id ${accountId}.` }, { status: 404 });
  }

  return NextResponse.json({ activity, yearComparison });
}
