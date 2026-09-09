import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { postBankTransactions, previewBankPosting, ValidationError } from "@/server/services/bank-posting-service";

/**
 * Post to Accounting — the bank transaction -> General Ledger step.
 *
 * Deliberately its own route rather than another case in
 * `transactions/bulk`: everything in that route edits transaction fields
 * under `Banking:Edit`, whereas this writes the ledger and needs
 * `Banking:Post`, which the RBAC seed grants from Senior Bookkeeper up
 * (0025_rbac_platform.sql). Keeping them apart is what makes that
 * distinction enforceable rather than incidental.
 *
 * `preview` is the read-only half the confirmation dialog calls first, so
 * the accountant sees exactly what will and will not post — and why —
 * before anything is written.
 */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Banking:Post");
  if (!check.ok) return check.response;

  const transactionIds: number[] = Array.isArray(body.transactionIds) ? body.transactionIds : [];

  try {
    if (body.preview === true) {
      const plan = await previewBankPosting(companyId, transactionIds);
      return NextResponse.json({
        readyCount: plan.journals.reduce((sum, j) => sum + j.transactionIds.length, 0),
        journalCount: plan.journals.length,
        journals: plan.journals.map((j) => ({ journalDate: j.journalDate, transactionCount: j.transactionIds.length })),
        alreadyPosted: plan.alreadyPosted,
        notReady: plan.notReady,
        blocked: plan.blocked,
      });
    }

    const outcome = await postBankTransactions(companyId, transactionIds);
    return NextResponse.json({ outcome });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
