import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  acceptQuotation,
  expireQuotation,
  getQuotation,
  NotFoundError,
  rejectQuotation,
  sendQuotation,
  ValidationError,
} from "@/server/services/quotation-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string; quotationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, quotationId } = await params;
  const quotation = await getQuotation(companyId, Number(quotationId));
  if (!quotation) return NextResponse.json({ error: "Quotation not found." }, { status: 404 });
  return NextResponse.json({ quotation });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; quotationId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, quotationId } = await params;
  const id = Number(quotationId);
  const body = await request.json();

  const check = await requirePermission(companyId, "Sales:Edit");
  if (!check.ok) return check.response;

  try {
    switch (body.action) {
      case "send": {
        const quotation = await sendQuotation(companyId, id);
        return NextResponse.json({ quotation });
      }
      case "accept": {
        const quotation = await acceptQuotation(companyId, id);
        return NextResponse.json({ quotation });
      }
      case "reject": {
        const quotation = await rejectQuotation(companyId, id);
        return NextResponse.json({ quotation });
      }
      case "expire": {
        const quotation = await expireQuotation(companyId, id);
        return NextResponse.json({ quotation });
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
