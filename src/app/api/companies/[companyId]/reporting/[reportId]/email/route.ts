import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { sendReportStatementEmail, ValidationError as EmailValidationError, NotFoundError as EmailNotFoundError } from "@/server/services/document-email-service";
import { ValidationError as DocumentValidationError, UsageLimitExceededError } from "@/server/services/document-service";
import { ValidationError as CommunicationValidationError, NotFoundError as CommunicationNotFoundError } from "@/server/services/communication-service";
import { PdfGenerationError } from "@/server/pdf/pdf-generation-service";
import { ReportInputError } from "@/server/report-centre/types";

/** Reporting Centre — email a Customer Statement to the customer's
 * primary contact, as the PDF of exactly the statement being viewed.
 * The only emailable report; same `Sales:Create` permission as the
 * existing statement email route. Sending records a communication and
 * archives the PDF — it never touches the ledger. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; reportId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, reportId } = await params;
  if (reportId !== "customer-statement") return NextResponse.json({ error: "Only customer statements can be emailed." }, { status: 400 });

  const check = await requirePermission(companyId, "Sales:Create");
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const customerId = Number(url.searchParams.get("customerId"));
  if (!Number.isInteger(customerId) || customerId <= 0) return NextResponse.json({ error: "Choose a customer." }, { status: 400 });

  const performedBy = await getPerformedByLabel();
  try {
    const communication = await sendReportStatementEmail(
      request,
      companyId,
      customerId,
      { dateFrom: url.searchParams.get("dateFrom") ?? undefined, dateTo: url.searchParams.get("dateTo") ?? undefined },
      performedBy,
    );
    return NextResponse.json({ communication }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailNotFoundError || error instanceof CommunicationNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof EmailValidationError || error instanceof DocumentValidationError || error instanceof CommunicationValidationError || error instanceof ReportInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof UsageLimitExceededError) return NextResponse.json({ error: error.message }, { status: 402 });
    if (error instanceof PdfGenerationError) return NextResponse.json({ error: error.message }, { status: 502 });
    throw error;
  }
}
