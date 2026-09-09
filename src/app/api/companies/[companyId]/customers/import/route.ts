import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { bulkImportCustomers } from "@/server/services/customer-service";

/** Finding #035 (RC-12) — bulk CSV import for Customers. Accepts raw CSV
 * text (not multipart) — the client reads the uploaded File via
 * `file.text()` first, matching the simplest path with no new body-
 * parsing infrastructure needed. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Sales:Create");
  if (!check.ok) return check.response;

  const body = await request.json();
  if (typeof body.csvText !== "string" || !body.csvText.trim()) {
    return NextResponse.json({ error: "csvText is required." }, { status: 400 });
  }

  const outcome = await bulkImportCustomers(companyId, body.csvText);
  return NextResponse.json({ outcome });
}
