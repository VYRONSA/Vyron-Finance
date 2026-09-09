import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { bulkImportSuppliers } from "@/server/services/supplier-management-service";

/** Finding #039 (RC-12) — mirrors customers/import/route.ts exactly. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Purchasing:Create");
  if (!check.ok) return check.response;

  const body = await request.json();
  if (typeof body.csvText !== "string" || !body.csvText.trim()) {
    return NextResponse.json({ error: "csvText is required." }, { status: 400 });
  }

  const outcome = await bulkImportSuppliers(companyId, body.csvText);
  return NextResponse.json({ outcome });
}
