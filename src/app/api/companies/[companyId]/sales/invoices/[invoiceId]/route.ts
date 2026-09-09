import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  approveAndPostInvoice,
  cancelInvoice,
  getSalesInvoice,
  NotFoundError,
  retryPostInvoice,
  submitInvoice,
  ValidationError,
} from "@/server/services/sales-invoice-service";
import { requireApproval, requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; invoiceId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, invoiceId } = await params;
  const invoice = await getSalesInvoice(companyId, Number(invoiceId));
  if (!invoice) return NextResponse.json({ error: "Sales invoice not found." }, { status: 404 });
  return NextResponse.json({ invoice });
}

/** `approve` performs the real, automatic Approve -> Posting Rule ->
 * Journal -> Posting Engine chain in one request — see
 * `sales-invoice-service.ts::approveAndPostInvoice`. */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; invoiceId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, invoiceId } = await params;
  const id = Number(invoiceId);
  const body = await request.json();

  try {
    switch (body.action) {
      case "submit": {
        const submitCheck = await requirePermission(companyId, "Sales:Edit");
        if (!submitCheck.ok) return submitCheck.response;
        const invoice = await submitInvoice(companyId, id);
        return NextResponse.json({ invoice });
      }
      case "approve": {
        const existing = await getSalesInvoice(companyId, id);
        if (!existing) return NextResponse.json({ error: `No sales invoice with id ${id}.` }, { status: 404 });
        // "Customer Credit Notes" is the directive's own named
        // approval-limit category; ordinary invoices/debit notes only
        // need the generic Sales:Approve permission (no amount limit).
        const approvalCheck =
          existing.documentType === "Credit Note"
            ? await requireApproval(companyId, "ApproveSales", "CustomerCreditNote", existing.total)
            : await requirePermission(companyId, "Sales:Approve");
        if (!approvalCheck.ok) return approvalCheck.response;
        const invoice = await approveAndPostInvoice(companyId, id);
        return NextResponse.json({ invoice });
      }
      case "retry-post": {
        const retryCheck = await requirePermission(companyId, "Sales:Edit");
        if (!retryCheck.ok) return retryCheck.response;
        const invoice = await retryPostInvoice(companyId, id);
        return NextResponse.json({ invoice });
      }
      case "cancel": {
        const cancelCheck = await requirePermission(companyId, "Sales:Edit");
        if (!cancelCheck.ok) return cancelCheck.response;
        const invoice = await cancelInvoice(companyId, id);
        return NextResponse.json({ invoice });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
