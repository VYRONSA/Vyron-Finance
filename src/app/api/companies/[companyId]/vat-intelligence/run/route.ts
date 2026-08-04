import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { runVatIntelligenceScan } from "@/server/services/vat-exception-scan-service";
import { requirePermission } from "@/server/services/permission-service";

/** Manual "Run VAT Intelligence Now" — scans every Sales Invoice/Credit
 * Note and Supplier Bill/Credit Note through VAT Intelligence and the
 * VAT Rule Engine, raising real VAT Exceptions. */
export async function POST(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const performedBy = await getPerformedByLabel();

  const check = await requirePermission(companyId, "ManageVAT");
  if (!check.ok) return check.response;

  const outcome = await runVatIntelligenceScan(companyId, performedBy);
  return NextResponse.json({ outcome });
}
