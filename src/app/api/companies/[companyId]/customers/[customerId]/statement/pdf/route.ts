import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getCustomer } from "@/server/services/customer-service";
import { generateStatementPdf, PdfGenerationError } from "@/server/pdf/pdf-generation-service";
import { statementPdfFilename } from "@/server/pdf/pdf-filename";

/** Phase 24A — Customer Statement PDF download. Same `Sales:View`
 * permission and reasoning as the invoice PDF route. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; customerId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, customerId } = await params;

  const check = await requirePermission(companyId, "Sales:View");
  if (!check.ok) return check.response;

  const customer = await getCustomer(companyId, Number(customerId));
  if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });

  try {
    const pdf = await generateStatementPdf(request, companyId, customer.id);
    const asOfDate = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${statementPdfFilename(customer.name, asOfDate)}"`,
        "Content-Length": String(pdf.length),
      },
    });
  } catch (error) {
    if (error instanceof PdfGenerationError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
