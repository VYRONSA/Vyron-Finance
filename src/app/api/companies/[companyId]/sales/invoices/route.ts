import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  createInvoiceFromOrder,
  createSalesInvoice,
  listSalesInvoices,
  listSalesInvoicesByCustomer,
  NotFoundError,
  ValidationError,
} from "@/server/services/sales-invoice-service";
import type { SalesInvoiceDocumentType } from "@/server/sales/types";
import { requirePermission } from "@/server/services/permission-service";

const VALID_DOCUMENT_TYPES: SalesInvoiceDocumentType[] = ["Invoice", "Credit Note", "Debit Note"];

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const documentTypeParam = url.searchParams.get("documentType");
  const customerIdParam = url.searchParams.get("customerId");

  if (documentTypeParam && !VALID_DOCUMENT_TYPES.includes(documentTypeParam as SalesInvoiceDocumentType)) {
    return NextResponse.json({ error: `Invalid documentType '${documentTypeParam}'.` }, { status: 400 });
  }

  const invoices = customerIdParam
    ? await listSalesInvoicesByCustomer(companyId, Number(customerIdParam))
    : await listSalesInvoices(companyId, (documentTypeParam as SalesInvoiceDocumentType) || undefined);
  return NextResponse.json({ invoices });
}

/** Either a direct document (`customerId`/`invoiceDate`/`vatTreatmentCode`/
 * `lines`) or a real Order -> Invoice conversion (`orderId`/`invoiceDate`/
 * `vatTreatmentCode`, no lines — the service copies the order's own lines
 * and requires it to be fully `Delivered` first). */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Sales:Create");
  if (!check.ok) return check.response;

  try {
    if (body.orderId) {
      const invoice = await createInvoiceFromOrder(companyId, Number(body.orderId), body.invoiceDate, body.vatTreatmentCode);
      return NextResponse.json({ invoice }, { status: 201 });
    }
    const invoice = await createSalesInvoice(companyId, body);
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
