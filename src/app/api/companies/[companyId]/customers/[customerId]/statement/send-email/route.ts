import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { sendStatementEmail, ValidationError as EmailValidationError, NotFoundError as EmailNotFoundError } from "@/server/services/document-email-service";
import { ValidationError as DocumentValidationError, UsageLimitExceededError } from "@/server/services/document-service";
import { ValidationError as CommunicationValidationError, NotFoundError as CommunicationNotFoundError } from "@/server/services/communication-service";
import { PdfGenerationError } from "@/server/pdf/pdf-generation-service";

/** Phase 24B — Send Customer Statement Email. Same `Sales:Create`
 * permission and reasoning as the invoice send-email route. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, customerId } = await params;

  const check = await requirePermission(companyId, "Sales:Create");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();

  try {
    const communication = await sendStatementEmail(request, companyId, Number(customerId), performedBy);
    return NextResponse.json({ communication }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailNotFoundError || error instanceof CommunicationNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof EmailValidationError || error instanceof DocumentValidationError || error instanceof CommunicationValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof UsageLimitExceededError) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    if (error instanceof PdfGenerationError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
