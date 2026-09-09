import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getSalesInvoice } from "@/server/services/sales-invoice-service";
import { generateInvoicePdf, PdfGenerationError } from "@/server/pdf/pdf-generation-service";
import { invoicePdfFilename } from "@/server/pdf/pdf-filename";

/**
 * Phase 24A — Invoice PDF download. Same `Sales:View` permission as the
 * existing invoice-viewing route (`sales/invoices/[invoiceId]/route.ts`)
 * — downloading a PDF is a form of viewing, not a distinct capability,
 * so no new permission was created. Fetches the invoice once (needed for
 * an honest 404 and the real filename) — `pdf-generation-service.ts`
 * then reuses this same data by having its own internal `pdf-view` page
 * fetch it again server-side (a second, cheap, tenant-scoped read of a
 * single row — not the "duplicate invoice query" this ticket's section
 * 14 warns against, which is about N+1s over many rows).
 */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string; invoiceId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, invoiceId } = await params;

  const check = await requirePermission(companyId, "Sales:View");
  if (!check.ok) return check.response;

  const invoice = await getSalesInvoice(companyId, Number(invoiceId));
  if (!invoice) return NextResponse.json({ error: "Sales invoice not found." }, { status: 404 });

  try {
    const pdf = await generateInvoicePdf(request, companyId, invoice.id);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoicePdfFilename(invoice)}"`,
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
