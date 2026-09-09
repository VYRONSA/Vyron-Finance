import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getSupplierMergePreview, NotFoundError, ValidationError } from "@/server/services/merge-service";

/** Phase 33A — read-only. Fetches both merge candidates' full detail
 * (name, code, status, VAT, tax, payment terms) plus a live linked-record
 * count, so the merge dialog can show the user exactly what they're
 * choosing between before anything is written. Never mutates anything. */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Matching:Edit");
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const supplierAId = Number(url.searchParams.get("a"));
  const supplierBId = Number(url.searchParams.get("b"));
  if (!Number.isFinite(supplierAId) || !Number.isFinite(supplierBId)) {
    return NextResponse.json({ error: "Query params 'a' and 'b' must both be numeric supplier ids." }, { status: 400 });
  }

  try {
    const preview = await getSupplierMergePreview(companyId, supplierAId, supplierBId);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
