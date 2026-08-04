import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { createQuotation, listQuotations, ValidationError } from "@/server/services/quotation-service";
import { requirePermission } from "@/server/services/permission-service";

export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const quotations = await listQuotations(companyId);
  return NextResponse.json({ quotations });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();

  const check = await requirePermission(companyId, "Sales:Create");
  if (!check.ok) return check.response;

  try {
    const quotation = await createQuotation(companyId, body);
    return NextResponse.json({ quotation }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
