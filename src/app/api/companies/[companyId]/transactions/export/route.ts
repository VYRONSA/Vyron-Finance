import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { listTransactionsForExport, parseFilters, ValidationError } from "@/server/services/transaction-explorer-service";
import { buildTransactionsCsv, buildTransactionsWorkbook } from "@/server/accounting/transaction-export";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  try {
    const filters = parseFilters(url.searchParams);
    const { transactions, truncated } = await listTransactionsForExport(companyId, filters);
    const truncatedHeader = truncated ? "1" : "0";

    if (format === "csv") {
      const csv = buildTransactionsCsv(transactions);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="transactions.csv"`,
          "X-Export-Truncated": truncatedHeader,
        },
      });
    }

    const workbook = await buildTransactionsWorkbook(transactions);
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="transactions.xlsx"`,
        "X-Export-Truncated": truncatedHeader,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
