import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { buildChartOfAccountsCsv, listChartOfAccounts } from "@/server/services/chart-of-accounts-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const accounts = await listChartOfAccounts(companyId);
  const csv = buildChartOfAccountsCsv(accounts);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chart-of-accounts.csv"`,
    },
  });
}
