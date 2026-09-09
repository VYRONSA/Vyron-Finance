import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { runXeroImport, XeroImportError } from "@/server/services/xero-import-service";
import { decodeCsvBuffer } from "@/server/import-centre/csv-utils";

/**
 * Xero Client Import — the real (not single-shot-CSV, not report-only)
 * migration entry point: Contacts (one or more batches), Sales
 * Invoices, Bills, and the Bank Transactions .xlsx, all in one request,
 * against an EXISTING company (create the company first via the normal
 * Company Creation flow, then run this). Reuses
 * `xero-import-service.ts::runXeroImport` — the same function a
 * server-side onboarding script calls — so the UI and any scripted
 * onboarding always go through identical logic.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Banking:Create");
  if (!check.ok) return check.response;

  const formData = await request.formData();
  const salesInvoicesFile = formData.get("salesInvoices");
  const billsFile = formData.get("bills");
  const contactsFiles = formData.getAll("contacts");
  const bankTransactionsFile = formData.get("bankTransactions");

  if (!(salesInvoicesFile instanceof File) && !(billsFile instanceof File) && contactsFiles.length === 0 && !(bankTransactionsFile instanceof File)) {
    return NextResponse.json({ error: "At least one file (contacts, salesInvoices, bills, or bankTransactions) is required." }, { status: 400 });
  }

  try {
    const performedBy = await getPerformedByLabel();

    const contactsCsvBatches = await Promise.all(
      contactsFiles.filter((f): f is File => f instanceof File).map(async (f) => ({ text: decodeCsvBuffer(await f.arrayBuffer()), filename: f.name })),
    );

    const outcome = await runXeroImport(
      companyId,
      {
        salesInvoicesCsv: salesInvoicesFile instanceof File ? { text: decodeCsvBuffer(await salesInvoicesFile.arrayBuffer()), filename: salesInvoicesFile.name } : undefined,
        billsCsv: billsFile instanceof File ? { text: decodeCsvBuffer(await billsFile.arrayBuffer()), filename: billsFile.name } : undefined,
        contactsCsvBatches,
        bankTransactionsXlsx: bankTransactionsFile instanceof File ? { buffer: Buffer.from(await bankTransactionsFile.arrayBuffer()), filename: bankTransactionsFile.name } : undefined,
      },
      performedBy ?? "System",
    );

    return NextResponse.json({ outcome }, { status: 201 });
  } catch (error) {
    if (error instanceof XeroImportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
