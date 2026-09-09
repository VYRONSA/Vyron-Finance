import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  buildDuplicatePaymentsRows,
  buildOutstandingSuppliersRows,
  buildSupplierAllocationRows,
  buildSupplierPaymentRows,
  buildUnknownPaymentsRows,
} from "@/server/accounting/reconciliation-reports";

const REPORT_BUILDERS = {
  "supplier-allocation": buildSupplierAllocationRows,
  "supplier-payment": buildSupplierPaymentRows,
  "outstanding-suppliers": buildOutstandingSuppliersRows,
  "unknown-payments": buildUnknownPaymentsRows,
  "duplicate-payments": buildDuplicatePaymentsRows,
} as const;

export type ReportType = keyof typeof REPORT_BUILDERS;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string; reportType: string }> },
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, reportType } = await params;
  const builder = REPORT_BUILDERS[reportType as ReportType];
  if (!builder) {
    return NextResponse.json(
      { error: `Unknown report type '${reportType}'. Valid types: ${Object.keys(REPORT_BUILDERS).join(", ")}` },
      { status: 404 },
    );
  }

  const rows = await builder(companyId);
  return NextResponse.json({ rows });
}
