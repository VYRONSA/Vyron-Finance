import { NextResponse } from "next/server";
import { getPerformedByLabel, requireSession } from "@/server/auth/require-session";
import {
  allocateCreditNote,
  approveAndPostInvoice,
  assignMissingLineAccounts,
  assignMissingPostedLineAccounts,
  cancelInvoice,
  ConflictError,
  ForbiddenError,
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

  // Phase 5I — same gap as the collection route: reading one invoice is a
  // Sales capability, and the PDF route for this document already
  // required `Sales:View`. RLS still enforces the tenant boundary.
  const check = await requirePermission(companyId, "Sales:View");
  if (!check.ok) return check.response;

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
      case "assign-line-accounts": {
        // Fills ONLY lines with no account, on a Draft, with an active
        // Income account — see `assignMissingLineAccounts`. Same
        // permission as the other Draft actions.
        const editCheck = await requirePermission(companyId, "Sales:Edit");
        if (!editCheck.ok) return editCheck.response;
        const invoice = await assignMissingLineAccounts(companyId, id, body.glAccount, await getPerformedByLabel());
        return NextResponse.json({ invoice });
      }
      case "assign-posted-line-accounts": {
        // Fills ONLY lines with no account, on a Posted invoice, with
        // account 1000 — metadata only, the journal is left exactly as it
        // is (see `assignMissingPostedLineAccounts`). A posted document, so
        // both the edit and the approve permission are required.
        const editCheck = await requirePermission(companyId, "Sales:Edit");
        if (!editCheck.ok) return editCheck.response;
        const approveCheck = await requirePermission(companyId, "Sales:Approve");
        if (!approveCheck.ok) return approveCheck.response;
        const invoice = await assignMissingPostedLineAccounts(companyId, id, body.glAccount, await getPerformedByLabel());
        return NextResponse.json({ invoice });
      }
      case "allocate-credit-note": {
        // Applies credit from THIS Posted credit note to a Posted invoice
        // of the same customer (migration 0121). Changes two posted
        // documents' balances, so both the edit and the approve permission
        // are required — checked here and again inside the database.
        const editCheck = await requirePermission(companyId, "Sales:Edit");
        if (!editCheck.ok) return editCheck.response;
        const approveCheck = await requirePermission(companyId, "Sales:Approve");
        if (!approveCheck.ok) return approveCheck.response;
        const allocation = await allocateCreditNote(companyId, id, Number(body.invoiceId), Number(body.amount), body.requestKey);
        return NextResponse.json({ allocation });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
