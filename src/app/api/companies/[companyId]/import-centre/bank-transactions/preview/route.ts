import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { previewPdfBankStatement, ValidationError } from "@/server/services/import-service";
import { requirePermission } from "@/server/services/permission-service";

/** Step 1 of the PDF Bank Statement Import review flow — parses and
 * validates a PDF statement without committing anything, so the Import
 * Review Screen has real data (or a real, honest "0 extracted, awaiting
 * validation" result) to render before the user can correct and confirm. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Banking:Create");
  if (!check.ok) return check.response;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  try {
    const preview = await previewPdfBankStatement(companyId, file);
    return NextResponse.json(preview, { status: 200 });
  } catch (error) {
    // Every anticipated "this PDF has a real problem" case — password
    // protected, scanned image, corrupted, unrecognised bank/layout —
    // is already a `ValidationError` by the time it reaches here (see
    // `previewPdfBankStatement`/`extractPdfText`), so it gets its own
    // specific message and a 400, never a bare 500. Anything else here
    // is a genuine, unexpected server fault: logged in full server-side
    // (captured in Vercel's function logs) but never echoed back to the
    // client, which only ever sees a safe, generic message — no "Request
    // failed" with nothing else, and no internals leaked either.
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("PDF preview failed unexpectedly:", error);
    return NextResponse.json({ error: "Something went wrong while processing this PDF. Please try again, or contact support if the problem continues." }, { status: 500 });
  }
}
