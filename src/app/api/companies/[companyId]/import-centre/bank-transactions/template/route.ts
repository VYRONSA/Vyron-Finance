import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { STANDARD_HEADERS } from "@/server/import-centre/bank-statement-parser";

/** Phase 32 — the one importer that genuinely supports both CSV and
 * XLSX gets both template formats ("provide both where practical").
 * `exceljs` is already a dependency (used to PARSE .xlsx bank statements
 * — `bank-statement-xlsx-parser.ts`) so this adds no new dependency,
 * just uses it to write instead of read. Headers only, in the exact
 * required order — no example data row, since the CSV/XLSX bank
 * template's header order is itself part of the contract
 * (`matchesStandardTemplate`) and a fabricated example row risks being
 * mistaken for real accounting data. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  await params;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bank Transactions");
  sheet.addRow(STANDARD_HEADERS);

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="VYRON_Bank_Transactions_Import_Template.xlsx"`,
    },
  });
}
