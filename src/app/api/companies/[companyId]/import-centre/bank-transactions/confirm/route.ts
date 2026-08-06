import { NextResponse } from "next/server";
import { requireSession, getCurrentUserEmail } from "@/server/auth/require-session";
import { confirmPdfBankStatementImport, ValidationError, type ConfirmPdfImportInput } from "@/server/services/import-service";
import { requirePermission } from "@/server/services/permission-service";

/** Step 2 of the PDF Bank Statement Import review flow — commits the
 * (possibly user-corrected) transactions from a prior `preview` call and
 * immediately runs them through the Banking Rules engine. Body shape
 * matches `ConfirmPdfImportInput` exactly — the client round-trips the
 * preview response's `metadata`/`transactions` back here after any
 * manual correction, rather than re-parsing the file. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Banking:Create");
  if (!check.ok) return check.response;

  const input = (await request.json()) as ConfirmPdfImportInput;
  if (!input?.batchId || !input?.sourceFilename || !Array.isArray(input?.transactions)) {
    return NextResponse.json({ error: "Missing batchId, sourceFilename, or transactions." }, { status: 400 });
  }

  try {
    const importedBy = (await getCurrentUserEmail()) ?? "System";
    const outcome = await confirmPdfBankStatementImport(companyId, input, importedBy);
    return NextResponse.json(outcome, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
