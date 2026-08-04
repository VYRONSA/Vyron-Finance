import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { getTrialBalance } from "@/server/services/trial-balance-service";
import { buildTrialBalanceCsv, buildTrialBalanceWorkbook } from "@/server/general-ledger/trial-balance-export";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const asOfDate = url.searchParams.get("asOfDate");

  const trialBalance = await getTrialBalance(companyId, asOfDate);

  if (format === "csv") {
    const csv = buildTrialBalanceCsv(trialBalance);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="trial-balance.csv"`,
      },
    });
  }

  const workbook = await buildTrialBalanceWorkbook(trialBalance);
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="trial-balance.xlsx"`,
    },
  });
}
