import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { ensureCompanyBankStatementEmail, NotFoundError } from "@/server/services/company-bank-statement-email-service";

/** Phase 21B — identity foundation only. Returns (lazily creating if
 * this is the first time) the company's stable inbound bank-statement
 * email identity. Session + RLS company access only, same as reading
 * any other Settings data — this route itself never receives or
 * processes inbound email; that happens at the separate webhook route
 * (`POST /api/webhooks/resend/bank-statements`, Phase 21C/21F), which
 * reads the identity this route manages. A dedicated route (rather than
 * folding this into `GET /api/companies/[companyId]`) because this one
 * has a real side effect on first call (lazy creation) that the plain
 * company GET must never have. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  try {
    const bankStatementEmail = await ensureCompanyBankStatementEmail(companyId);
    return NextResponse.json({ bankStatementEmail });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
